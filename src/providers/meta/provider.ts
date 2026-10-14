import type { DatabaseSync } from 'node:sqlite';
import type {
  AccountRef,
  ConnectionValidation,
  DirectAttachmentPayload,
  DirectMessagePayload,
  ConversationDiagnostics,
  DiagnosticMessage,
  DiscoveredAccount,
  MediaItem,
  MetaErrorDetails,
  MediaType,
  MessageReadback,
  PrivateReplyPayload,
  ProviderComment,
  ProviderPage,
  PublicReplyResult,
  SendResult,
  SocialProvider,
  TapResult,
  TapSearch,
  ModerationResult,
  UserProfileProbe,
} from '../../core/domain.ts';
import {
  getAccountCredential,
  getAccountSummary,
  getConnectionCredential,
  getConnectionSummary,
} from '../../db/repositories.ts';
import { PlatformFeatureNotSupportedError, PlatformNotSupportedError } from '../../core/errors.ts';
import { redactSecrets } from '../../security/redact.ts';
import type { CredentialVault } from '../../security/vault.ts';
import {
  INTERACTIVE_MAX_BUTTONS, INTERACTIVE_PAYLOAD_PATTERN, INTERACTIVE_TITLE_MAX, looksLikeUrl, normalizeMatchText,
} from '../../services/automations.ts';
import {
  FACEBOOK_PAGE_ACCOUNT_TYPE, PLATFORM_FEATURE_NOT_SUPPORTED_CODE, assertPlatformEnabled, facebookMessageText, facebookPagesAvailable,
} from '../../services/facebook-pages-rules.ts';
import { GATE_MAX_DETAIL_CALLS, normalizeTapText } from '../../services/follow-gate-rules.ts';
import { isAttachmentKind, isPublicHttpsUrl } from '../../services/resource-attachment.ts';

type MetaObject = Record<string, unknown>;
const READBACK_MAX_RECIPIENTS = 50;
const READBACK_MAX_ATTACHMENTS = 5;
const READBACK_MAX_BUTTONS = 10;
const READBACK_MAX_TITLE = 640;
type CursorResult = { kind: 'none' } | { kind: 'unsafe' } | { kind: 'cursor'; cursor: string };

const PAGE_LIMIT = 100;
const BODY_LIMIT = 1_048_576;
const REQUEST_TIMEOUT_MS = 10_000;
const META_HOSTS = {
  instagram_login: 'https://graph.instagram.com',
  facebook_login: 'https://graph.facebook.com',
} as const;

export class MetaProvider implements SocialProvider {
  private readonly pageTokens = new Map<string, Map<string, string>>();

  constructor(
    private readonly database: DatabaseSync,
    private readonly vault: CredentialVault,
    private readonly fetcher: typeof fetch = fetch,
    /** `facebookPagesAvailable` carries the SOCIAL_DESK_FACEBOOK_PAGES opt-in (tests may override it). */
    private readonly options: { diagnosticSpacingMs?: number; facebookPagesAvailable?: boolean } = {},
  ) {}

  async validateConnection(connectionId: string): Promise<ConnectionValidation> {
    const credential = getConnectionCredential(this.database, connectionId);
    try {
      const token = this.vault.decrypt(connectionId, credential.secret);
      const path = credential.loginKind === 'instagram_login'
        ? '/me?fields=id,username,account_type'
        : '/me?fields=id,name';
      const response = await this.request(credential.loginKind, credential.graphVersion, path, token);
      const providerUserId = string(response.id);
      const username = string(response.username) ?? string(response.name);
      if (!providerUserId) throw new MetaSafeError('meta_invalid_identity');
      return {
        status: 'valid',
        observedAt: new Date().toISOString(),
        providerUserId,
        username,
        capabilities: ['identity_read'],
      };
    } catch (error) {
      return invalidValidation(error);
    }
  }

  async discoverAccounts(connectionId: string): Promise<DiscoveredAccount[]> {
    const connection = getConnectionCredential(this.database, connectionId);
    const token = this.vault.decrypt(connectionId, connection.secret);
    const accounts = new Map<string, DiscoveredAccount>();
    const pageTokens = new Map<string, string>();

    if (connection.loginKind === 'instagram_login') {
      const profile = await this.request(
        'instagram_login',
        connection.graphVersion,
        '/me?fields=id,username,account_type',
        token,
      );
      const providerAccountId = string(profile.id);
      const username = string(profile.username);
      if (!providerAccountId || !username) throw new MetaSafeError('meta_invalid_identity');

      accounts.set(providerAccountId, {
        providerAccountId,
        username,
        accountType: string(profile.account_type),
        capabilities: ['identity_read', 'private_reply_unverified'],
      });
    } else {
      const pages = await this.collectPages(
        connection.graphVersion,
        '/me/accounts?fields=id,name,access_token,tasks,instagram_business_account&limit=100',
        token,
      );
      for (const page of pages) {
        const relatedPageId = string(page.id);
        const pageToken = string(page.access_token);
        if (!relatedPageId || !pageToken) continue;
        const pageTasks = Array.isArray(page.tasks)
          ? page.tasks.filter((task): task is string => typeof task === 'string').sort()
          : [];
        const linkedAccount = object(page.instagram_business_account);
        const providerAccountId = string(linkedAccount?.id);

        if (providerAccountId) {
          const details = await this.request(
            'facebook_login',
            connection.graphVersion,
            `/${encodeURIComponent(providerAccountId)}?fields=id,username,account_type`,
            pageToken,
          );
          const username = string(details.username);
          if (username) {
            accounts.set(providerAccountId, {
              providerAccountId,
              username,
              displayName: string(page.name),
              accountType: string(details.account_type),
              relatedPageId,
              capabilities: [
                'identity_read',
                'private_reply_unverified',
                ...pageTasks.map((task) => `page_task:${task}`),
              ],
            });
            pageTokens.set(providerAccountId, pageToken);
          }
        }

        // Dormant until tanda 2: the Page itself becomes a candidate (with or without a linked Instagram account).
        if (facebookPagesAvailable(this.options.facebookPagesAvailable)) {
          const pageName = string(page.name) ?? relatedPageId;
          accounts.set(relatedPageId, {
            providerAccountId: relatedPageId,
            username: pageName,
            displayName: pageName,
            accountType: FACEBOOK_PAGE_ACCOUNT_TYPE,
            relatedPageId,
            platform: 'facebook',
            capabilities: ['identity_read', ...pageTasks.map((task) => `page_task:${task}`)],
          });
          pageTokens.set(relatedPageId, pageToken);
        }
      }
    }

    this.pageTokens.set(connectionId, pageTokens);
    return [...accounts.values()];
  }

  async credentialForSelectedAccount(
    connectionId: string,
    account: DiscoveredAccount,
  ): Promise<string | undefined> {
    const connection = getConnectionCredential(this.database, connectionId);
    if (connection.loginKind === 'instagram_login') return undefined;
    return this.pageTokens.get(connectionId)?.get(account.providerAccountId);
  }

  async listMedia(account: AccountRef, cursor?: string): Promise<ProviderPage<MediaItem>> {
    const { connection, token, platform } = this.accountContext(account);
    if (platform === 'facebook') return this.facebookListMedia(account, connection, token, cursor);
    const path = `/${encodeURIComponent(account.providerAccountId)}/media?fields=id,permalink,timestamp,caption,media_type,media_url,thumbnail_url&limit=100`;
    return this.collectItems(
      connection.loginKind,
      connection.graphVersion,
      path,
      token,
      cursor,
      (item) => ({
        mediaId: requiredString(item.id),
        permalink: string(item.permalink),
        publishedAt: string(item.timestamp),
        caption: mediaCaption(item.caption),
        mediaType: mediaType(item.media_type),
        thumbnailUrl: parseThumbnailUrl(item.thumbnail_url, item.media_url),
      }),
    );
  }

  async listComments(account: AccountRef, mediaId: string, cursor?: string): Promise<ProviderPage<ProviderComment>> {
    const { connection, token, platform } = this.accountContext(account);
    this.assertMediaBelongsToAccount(account.accountId, mediaId);
    if (platform === 'facebook') {
      return this.collectItems('facebook_login', connection.graphVersion,
        `/${encodeURIComponent(mediaId)}/comments?filter=stream&summary=true&fields=${FACEBOOK_COMMENT_FIELDS}&limit=100`,
        token, cursor, facebookComment, 1);
    }
    const path = `/${encodeURIComponent(mediaId)}/comments?fields=id,text,username,from,timestamp,parent_id&limit=100`;
    return this.collectItems(
      connection.loginKind,
      connection.graphVersion,
      path,
      token,
      cursor,
      (item) => ({
        commentId: requiredString(item.id),
        text: string(item.text),
        username: commentAuthor(item),
        createdAt: string(item.timestamp),
        parentId: string(item.parent_id),
        authorId: commentAuthorId(item),
      }),
      1,
    );
  }

  async getComment(account: AccountRef, commentId: string): Promise<ProviderComment> {
    const { connection, token, platform } = this.accountContext(account);
    this.assertCommentBelongsToAccount(account.accountId, commentId);
    if (platform === 'facebook') {
      return facebookComment(await this.request('facebook_login', connection.graphVersion,
        `/${encodeURIComponent(commentId)}?fields=${FACEBOOK_COMMENT_FIELDS}`, token));
    }
    const row = await this.request(
      connection.loginKind,
      connection.graphVersion,
      `/${encodeURIComponent(commentId)}?fields=id,text,username,from,timestamp,parent_id`,
      token,
    );
    return {
      commentId: requiredString(row.id),
      text: string(row.text),
      username: commentAuthor(row),
      createdAt: string(row.timestamp),
      parentId: string(row.parent_id),
      authorId: commentAuthorId(row),
    };
  }

  async sendPrivateReply(
    account: AccountRef,
    commentId: string,
    payload: PrivateReplyPayload,
  ): Promise<SendResult> {
    const { connection, token, platform } = this.accountContext(account);
    if (platform === 'facebook') return this.facebookSendPrivateReply(account, connection.graphVersion, token, commentId, payload);
    if (!validPrivateReplyPayload(payload)) {
      return { outcome: 'definitive_rejection', safeErrorCode: 'invalid_reply_payload' };
    }
    try {
      this.assertCommentBelongsToAccount(account.accountId, commentId);
    } catch {
      return { outcome: 'definitive_rejection', safeErrorCode: 'comment_not_owned' };
    }

    const buttons: Array<Record<string, string>> = payload.buttons.map((button) => ({
      type: 'web_url',
      title: button.title,
      url: button.url,
    }));
    // Follow gate button: a postback button inside the button template (Meta's Instagram button template docs). The
    // experimental quick replies were retired and are rejected by validPrivateReplyPayload before any request.
    const interactive = Boolean(payload.postbackButtons?.length);
    for (const button of payload.postbackButtons ?? []) buttons.push({ type: 'postback', title: button.title, payload: button.payload });
    const message = buttons.length
      ? { attachment: { type: 'template', payload: { template_type: 'button', text: payload.text, buttons } } }
      : { text: payload.text };

    try {
      const result = await this.request(
        connection.loginKind,
        connection.graphVersion,
        `/${encodeURIComponent(account.providerAccountId)}/messages`,
        token,
        { method: 'POST', body: JSON.stringify({ recipient: { comment_id: commentId }, message }) },
      );
      const messageId = string(result.message_id)?.trim();
      if (!messageId) {
        return { outcome: 'ambiguous', safeErrorCode: 'meta_missing_message_id', usageHeaders: safeUsage(object(result.__safe_usage)) };
      }
      const recipientId = opaqueId(result.recipient_id);
      return { outcome: 'accepted', messageId, ...(recipientId ? { recipientId } : {}), usageHeaders: safeUsage(object(result.__safe_usage)) };
    } catch (error) {
      return interactive ? interactiveSendFailure(error) : sendFailure(error);
    }
  }

  /**
   * Public reply to a comment: `POST /{comment-id}/replies` with `message`, on graph.instagram.com (Instagram Login,
   * Instagram user token; needs instagram_business_manage_comments) or graph.facebook.com (Facebook Login, Page token;
   * needs instagram_manage_comments). The text is sent as a JSON body, never in the URL. Same request rules as every
   * other call: fixed host, bearer header, redirects rejected, bounded body and timeout.
   */
  async replyToComment(account: AccountRef, commentId: string, message: string): Promise<PublicReplyResult> {
    const { connection, token, platform } = this.accountContext(account);
    // Facebook public replies (POST /{comment}/comments) are NOT verified live: refused with a typed code, no request.
    if (platform === 'facebook') return { outcome: 'definitive_rejection', safeErrorCode: PLATFORM_FEATURE_NOT_SUPPORTED_CODE };
    if (typeof message !== 'string' || !message.trim() || message.length > PUBLIC_REPLY_MESSAGE_MAX) {
      return { outcome: 'definitive_rejection', safeErrorCode: 'invalid_public_reply' };
    }
    try {
      this.assertCommentBelongsToAccount(account.accountId, commentId);
    } catch {
      return { outcome: 'definitive_rejection', safeErrorCode: 'comment_not_owned' };
    }
    try {
      const result = await this.request(
        connection.loginKind,
        connection.graphVersion,
        `/${encodeURIComponent(commentId)}/replies`,
        token,
        { method: 'POST', body: JSON.stringify({ message }) },
      );
      const usageHeaders = safeUsage(object(result.__safe_usage));
      const replyId = string(result.id)?.trim();
      if (!replyId) return { outcome: 'ambiguous', safeErrorCode: 'meta_missing_reply_id', usageHeaders };
      return { outcome: 'accepted', replyId, usageHeaders };
    } catch (error) {
      return publicReplyFailure(error);
    }
  }

  async setCommentHidden(account: AccountRef, commentId: string, hidden: boolean): Promise<ModerationResult> {
    try {
      this.assertCommentBelongsToAccount(account.accountId, commentId);
    } catch {
      return { status: 'rejected', safeErrorCode: 'comment_not_owned' };
    }
    const { connection, token, platform } = this.accountContext(account);
    // Facebook hide (is_hidden) is NOT verified live: refused with a typed code, no request.
    if (platform === 'facebook') return { status: 'rejected', safeErrorCode: PLATFORM_FEATURE_NOT_SUPPORTED_CODE };
    try {
      const result = await this.request(
        connection.loginKind,
        connection.graphVersion,
        `/${encodeURIComponent(commentId)}`,
        token,
        { method: 'POST', body: JSON.stringify({ hide: hidden }) },
      );
      if (result.success === true) return { status: 'accepted' };
      return { status: 'ambiguous', safeErrorCode: 'meta_ambiguous_success' };
    } catch (error) {
      return moderationFailure(error);
    }
  }

  async deleteComment(account: AccountRef, commentId: string): Promise<ModerationResult> {
    try {
      this.assertCommentBelongsToAccount(account.accountId, commentId);
    } catch {
      return { status: 'rejected', safeErrorCode: 'comment_not_owned' };
    }
    const { connection, token, platform } = this.accountContext(account);
    if (platform === 'facebook') return { status: 'rejected', safeErrorCode: PLATFORM_FEATURE_NOT_SUPPORTED_CODE };
    try {
      const result = await this.request(
        connection.loginKind,
        connection.graphVersion,
        `/${encodeURIComponent(commentId)}`,
        token,
        { method: 'DELETE' },
      );
      if (result.success === true) return { status: 'accepted' };
      return { status: 'ambiguous', safeErrorCode: 'meta_ambiguous_success' };
    } catch (error) {
      return moderationFailure(error);
    }
  }

  /**
   * READ-ONLY diagnostics (follow gate phase 0, experimental). GET requests only: find the conversation with one user
   * (`/{ig-id}/conversations?platform=instagram&user_id=`), list its message ids (`/{conversation-id}?fields=messages`)
   * and read at most the 20 most recent (Meta only serves details of the last 20). Every message is reduced to a
   * bounded summary; raw bodies are never returned. Calls are spaced (Meta documents 2 calls/s for this API).
   */
  async diagnoseConversation(account: AccountRef, igsid: string): Promise<ConversationDiagnostics> {
    if (!opaqueId(igsid)) return { found: false, messages: [], safeErrorCode: 'invalid_igsid' };
    const { connection, token } = this.instagramContext(account);
    const get = async (path: string, first = false): Promise<MetaObject> => {
      if (!first) await this.diagnosticPause();
      return this.request(connection.loginKind, connection.graphVersion, path, token);
    };
    try {
      const query = new URLSearchParams({ platform: 'instagram', user_id: igsid });
      const conversations = await get(`/${encodeURIComponent(account.providerAccountId)}/conversations?${query.toString()}`, true);
      if (!Array.isArray(conversations.data)) return { found: false, messages: [], safeErrorCode: 'invalid_provider_response' };
      const first = conversations.data[0];
      if (first === undefined) return { found: false, messages: [] };
      const conversationId = opaqueId(object(first)?.id, 256);
      if (!conversationId) return { found: false, messages: [], safeErrorCode: 'invalid_provider_response' };
      const listing = await get(`/${encodeURIComponent(conversationId)}?fields=messages`);
      const rows = object(listing.messages)?.data;
      if (!Array.isArray(rows)) return { found: true, messages: [], safeErrorCode: 'invalid_provider_response' };
      const ids = rows.slice(0, DIAGNOSTIC_MAX_MESSAGES).map((row) => opaqueId(object(row)?.id, 256)).filter((id): id is string => Boolean(id));
      const messages: DiagnosticMessage[] = [];
      for (const id of ids) {
        try {
          const raw = await get(`/${encodeURIComponent(id)}?fields=id,created_time,from,to,message,attachments`);
          messages.push(summarizeMessage(id, raw, account));
        } catch (error) {
          messages.push({ id, direction: 'unknown', keys: [], attachmentsShape: 'missing', safeErrorCode: safeMetaCode(error) });
        }
      }
      return { found: true, messages };
    } catch (error) {
      return { found: false, messages: [], safeErrorCode: safeMetaCode(error) };
    }
  }

  /**
   * Follow gate resource: `POST /{ig-id}/messages` with `{ recipient: { id: <IGSID> }, message }` (Instagram Messaging
   * API, Send API). Either text or a button template with web_url buttons, built exactly like the private reply, or ONE
   * attachment by URL (`{ attachment: { type: image|audio|video|file, payload: { url } } }`; Meta downloads the file, so
   * a slow download may surface as a timeout = ambiguous). Buttons and media never travel in the same message. Meta only
   * accepts it within 24 h after the user's last message. Same hardened request path; errors map like private sends.
   */
  async sendMessage(account: AccountRef, igsid: string, payload: DirectMessagePayload | DirectAttachmentPayload): Promise<SendResult> {
    if (!opaqueId(igsid)) return { outcome: 'definitive_rejection', safeErrorCode: 'invalid_igsid' };
    let message: Record<string, unknown>;
    if (payload && typeof payload === 'object' && 'attachment' in payload) {
      // Attachment follow-up: `message.attachment = { type, payload: { url } }` (Instagram Messaging API, "Send media").
      // Only image/audio/video/file with a public HTTPS URL, and nothing else in the payload (no text, no buttons).
      const attachment = (payload as DirectAttachmentPayload).attachment as unknown as Record<string, unknown> | null;
      if (Object.keys(payload).length !== 1 || !isObject(attachment) || !isAttachmentKind(attachment.kind) || !isPublicHttpsUrl(attachment.url)) {
        return { outcome: 'definitive_rejection', safeErrorCode: 'invalid_message_payload' };
      }
      message = { attachment: { type: attachment.kind, payload: { url: attachment.url } } };
    } else {
      const candidate = payload as PrivateReplyPayload;
      if (!candidate || candidate.quickReplies !== undefined || candidate.postbackButtons !== undefined || !validPrivateReplyPayload(candidate)) {
        return { outcome: 'definitive_rejection', safeErrorCode: 'invalid_message_payload' };
      }
      const buttons = candidate.buttons.map((button) => ({ type: 'web_url', title: button.title, url: button.url }));
      message = buttons.length
        ? { attachment: { type: 'template', payload: { template_type: 'button', text: candidate.text, buttons } } }
        : { text: candidate.text };
    }
    const { connection, token } = this.instagramContext(account);
    try {
      const result = await this.request(connection.loginKind, connection.graphVersion,
        `/${encodeURIComponent(account.providerAccountId)}/messages`, token,
        { method: 'POST', body: JSON.stringify({ recipient: { id: igsid }, message }) });
      const messageId = string(result.message_id)?.trim();
      if (!messageId) return { outcome: 'ambiguous', safeErrorCode: 'meta_missing_message_id', usageHeaders: safeUsage(object(result.__safe_usage)) };
      const recipientId = opaqueId(result.recipient_id);
      return { outcome: 'accepted', messageId, ...(recipientId ? { recipientId } : {}), usageHeaders: safeUsage(object(result.__safe_usage)) };
    } catch (error) {
      return sendFailure(error);
    }
  }

  /**
   * Follow gate tap lookup (GET only, bounded): finds the conversation with the user, lists its message ids and reads
   * details newest-first (at most GATE_MAX_DETAIL_CALLS, spaced) until a message is older than `afterIso`. Messages of
   * the account are ignored. Returns the earliest user message read whose normalized text equals the title. A tap on a
   * postback button appears in the conversation as a user message with the button title (verified live; no payload).
   */
  async findUserTap(account: AccountRef, igsid: string, search: TapSearch): Promise<TapResult> {
    if (!opaqueId(igsid)) return { found: false, pollError: 'invalid_igsid' };
    const after = Date.parse(search?.afterIso ?? '');
    if (!Number.isFinite(after) || typeof search.titleNormalized !== 'string' || !search.titleNormalized) {
      return { found: false, pollError: 'invalid_tap_search' };
    }
    const { connection, token } = this.instagramContext(account);
    const get = async (path: string, first = false): Promise<MetaObject> => {
      if (!first) await this.diagnosticPause();
      return this.request(connection.loginKind, connection.graphVersion, path, token);
    };
    try {
      const query = new URLSearchParams({ platform: 'instagram', user_id: igsid });
      const conversations = await get(`/${encodeURIComponent(account.providerAccountId)}/conversations?${query.toString()}`, true);
      if (!Array.isArray(conversations.data)) return { found: false, pollError: 'invalid_provider_response' };
      if (conversations.data[0] === undefined) return { found: false };
      const conversationId = opaqueId(object(conversations.data[0])?.id, 256);
      if (!conversationId) return { found: false, pollError: 'invalid_provider_response' };
      const listing = await get(`/${encodeURIComponent(conversationId)}?fields=messages`);
      const rows = object(listing.messages)?.data;
      if (!Array.isArray(rows)) return { found: false, pollError: 'invalid_provider_response' };
      const ids = rows.slice(0, DIAGNOSTIC_MAX_MESSAGES).map((row) => opaqueId(object(row)?.id, 256)).filter((id): id is string => Boolean(id));
      let match: { id: string; at: number } | undefined;
      for (const id of ids.slice(0, GATE_MAX_DETAIL_CALLS)) {
        const raw = await get(`/${encodeURIComponent(id)}?fields=id,created_time,from,to,message`);
        const created = Date.parse(string(raw.created_time) ?? '');
        if (!Number.isFinite(created)) continue;
        if (created < after) break;
        if (summarizeMessage(id, raw, account).direction !== 'user') continue;
        const text = string(raw.message);
        if (text !== undefined && normalizeTapText(text) === search.titleNormalized && (!match || created <= match.at)) match = { id, at: created };
      }
      return match ? { found: true, tapMessageId: match.id, tapAt: new Date(match.at).toISOString() } : { found: false };
    } catch (error) {
      return { found: false, pollError: safeMetaCode(error) };
    }
  }

  /**
   * READ-ONLY follow check (experimental): `GET /{igsid}?fields=name,username,is_user_follow_business,is_business_follow_user`.
   * Only the two booleans are returned. Meta requires prior user consent (the user messaged the account); the
   * documented "User consent is required" error maps to `user_consent_required`.
   */
  async getUserProfile(account: AccountRef, igsid: string): Promise<UserProfileProbe> {
    if (!opaqueId(igsid)) return { ok: false, safeErrorCode: 'invalid_igsid' };
    const { connection, token } = this.instagramContext(account);
    const requestedFields = PROFILE_FIELDS;
    const hostKind = connection.loginKind === 'instagram_login' ? 'instagram' as const : 'facebook' as const;
    try {
      const profile = await this.request(connection.loginKind, connection.graphVersion,
        `/${encodeURIComponent(igsid)}?fields=${requestedFields}`, token);
      return {
        ok: true,
        requestedFields,
        hostKind,
        ...(typeof profile.is_user_follow_business === 'boolean' ? { isUserFollowBusiness: profile.is_user_follow_business } : {}),
        ...(typeof profile.is_business_follow_user === 'boolean' ? { isBusinessFollowUser: profile.is_business_follow_user } : {}),
      };
    } catch (error) {
      const details = error instanceof MetaSafeError ? error.details : undefined;
      const metaError = details ? { ...details, ...(details.message ? { message: redactMetaMessage(details.message, token) } : {}) } : undefined;
      return {
        ok: false,
        safeErrorCode: error instanceof MetaSafeError && error.consentRequired ? 'user_consent_required' : safeMetaCode(error),
        ...(metaError && Object.keys(metaError).length > 0 ? { metaError } : {}),
        requestedFields,
        hostKind,
      };
    }
  }

  /**
   * Facebook Page feed: `GET /{page-id}/feed` (verified live with a Page token). Only published posts are returned
   * (an unpublished or scheduled post cannot have comments). Same hardened `request`/`collectItems` path as Instagram.
   */
  private async facebookListMedia(
    account: AccountRef,
    connection: ReturnType<typeof getConnectionCredential>,
    token: string,
    cursor?: string,
  ): Promise<ProviderPage<MediaItem>> {
    const page = await this.collectItems<MediaItem & { published: boolean }>(
      'facebook_login',
      connection.graphVersion,
      `/${encodeURIComponent(account.providerAccountId)}/feed?fields=id,created_time,message,permalink_url,is_published&limit=100`,
      token,
      cursor,
      (item) => ({
        mediaId: requiredString(item.id),
        permalink: string(item.permalink_url),
        publishedAt: string(item.created_time),
        caption: mediaCaption(item.message),
        mediaType: 'POST' as const,
        thumbnailUrl: undefined,
        published: item.is_published !== false,
      }),
    );
    return { ...page, items: page.items.filter((item) => item.published).map(({ published: _published, ...media }) => media) };
  }

  /**
   * Facebook private reply: `POST /{page-id}/messages` with `{ recipient: { comment_id }, message: { text } }` and a
   * bearer header (verified live: returns `recipient_id` + `message_id`). Text only. Facebook buttons/templates are NOT
   * verified, so URL buttons are appended to the text as `<title>: <https url>` lines; postback buttons and quick
   * replies are never sent. Nothing but the Authorization header carries the token.
   */
  private async facebookSendPrivateReply(
    account: AccountRef,
    version: string,
    token: string,
    commentId: string,
    payload: PrivateReplyPayload,
  ): Promise<SendResult> {
    if (!validPrivateReplyPayload(payload) || payload.postbackButtons !== undefined || payload.quickReplies !== undefined) {
      return { outcome: 'definitive_rejection', safeErrorCode: 'invalid_reply_payload' };
    }
    const text = facebookMessageText(payload.text, payload.buttons);
    if (text === undefined) return { outcome: 'definitive_rejection', safeErrorCode: 'invalid_reply_payload' };
    try {
      this.assertCommentBelongsToAccount(account.accountId, commentId);
    } catch {
      return { outcome: 'definitive_rejection', safeErrorCode: 'comment_not_owned' };
    }
    try {
      const result = await this.request('facebook_login', version, `/${encodeURIComponent(account.providerAccountId)}/messages`, token,
        { method: 'POST', body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }) });
      const messageId = string(result.message_id)?.trim();
      if (!messageId) {
        return { outcome: 'ambiguous', safeErrorCode: 'meta_missing_message_id', usageHeaders: safeUsage(object(result.__safe_usage)) };
      }
      const recipientId = opaqueId(result.recipient_id);
      return { outcome: 'accepted', messageId, ...(recipientId ? { recipientId } : {}), usageHeaders: safeUsage(object(result.__safe_usage)) };
    } catch (error) {
      return facebookSendFailure(error);
    }
  }

  private async diagnosticPause(): Promise<void> {
    const spacing = Math.max(0, this.options.diagnosticSpacingMs ?? DIAGNOSTIC_SPACING_MS);
    if (spacing > 0) await new Promise((resolve) => setTimeout(resolve, spacing));
  }

  async readMessage(account: AccountRef, messageId: string): Promise<MessageReadback> {
    const { connection, token, platform } = this.accountContext(account);
    // Meta gives no verified way to read a Facebook message back: never claim one.
    if (platform === 'facebook') throw new PlatformFeatureNotSupportedError('message_readback');
    const result = await this.request(
      connection.loginKind,
      connection.graphVersion,
      `/${encodeURIComponent(messageId)}?fields=id,created_time,from,to,message,attachments`,
      token,
    );
    const observedId = string(result.id);
    const sender = object(result.from);
    const senderId = string(sender?.id);
    const senderUsername = string(sender?.username);
    const toObject = object(result.to);
    const toShape: ReadbackDiagnostics['toShape'] = Array.isArray(result.to) ? 'array'
      : toObject && Array.isArray(toObject.data) ? 'data'
        : result.to === undefined || result.to === null ? 'missing' : 'other';
    const rawRecipients = Array.isArray(result.to) ? result.to : toObject && Array.isArray(toObject.data) ? toObject.data : [];
    const recipients = rawRecipients.slice(0, READBACK_MAX_RECIPIENTS).filter(isObject);
    // Meta may report the sender with the Instagram account id instead of the app-scoped id from Instagram Login;
    // usernames are unique per account, so an equal normalized username is an accepted alias.
    const usernamePresent = senderUsername !== undefined && senderUsername.trim() !== '';
    const usernameMatches = usernamePresent && normalizeMatchText(senderUsername) === normalizeMatchText(account.username);
    const senderIdMatches = senderId === account.providerAccountId;
    const idMatches = observedId === messageId;
    const attachmentsObject = object(result.attachments);
    const failureCode = !idMatches ? 'meta_readback_id_mismatch'
      : !(senderIdMatches || usernameMatches) ? 'meta_readback_sender_mismatch'
        : recipients.length === 0 ? 'meta_readback_no_recipient' : undefined;
    if (failureCode) {
      const error = new MetaSafeError(failureCode);
      error.diagnostics = {
        idMatches, senderIdMatches, usernamePresent, usernameMatches, recipientCount: recipients.length, toShape,
        hasAttachments: result.attachments !== undefined && result.attachments !== null,
        attachmentsShape: Array.isArray(result.attachments) ? 'array'
          : attachmentsObject && Array.isArray(attachmentsObject.data) ? 'data'
            : result.attachments === undefined || result.attachments === null ? 'missing' : 'other',
      };
      throw error;
    }

    const rawAttachments = Array.isArray(result.attachments)
      ? result.attachments
      : object(result.attachments) && Array.isArray(object(result.attachments)!.data) ? object(result.attachments)!.data as unknown[] : [];
    const attachmentObjects = rawAttachments.slice(0, READBACK_MAX_ATTACHMENTS).filter(isObject);
    const attachments = Array.isArray(result.attachments)
      ? attachmentObjects.map((attachment) => ({
        type: string(attachment.type),
        payload: object(attachment.payload),
      }))
      : undefined;
    const templates = attachmentObjects.flatMap((attachment) => {
      const template = object(attachment.generic_template);
      if (!template) return [];
      const buttons = (Array.isArray(template.cta) ? template.cta : []).slice(0, READBACK_MAX_BUTTONS).flatMap((cta) => {
        const title = isObject(cta) ? string(cta.title) : undefined;
        const url = isObject(cta) ? string(cta.url) : undefined;
        return title !== undefined && url !== undefined
          ? [{ title: title.slice(0, 80), url: url.slice(0, 2000), type: string((cta as MetaObject).type)?.slice(0, 20) }]
          : [];
      });
      return [{ title: string(template.title)?.slice(0, READBACK_MAX_TITLE), buttons }];
    });
    return {
      messageId,
      senderId,
      recipientId: string(recipients[0]?.id),
      text: string(result.message),
      createdAt: string(result.created_time),
      attachments,
      ...(templates.length ? { templates } : {}),
      observedAt: new Date().toISOString(),
    };
  }

  /** Context for Instagram-only endpoints (follow gate, conversation diagnostics): a Page account never reaches them. */
  private instagramContext(account: AccountRef): { connection: ReturnType<typeof getConnectionCredential>; token: string } {
    const context = this.accountContext(account);
    if (context.platform !== 'instagram') throw new PlatformFeatureNotSupportedError('instagram_only');
    return context;
  }

  private accountContext(account: AccountRef): {
    connection: ReturnType<typeof getConnectionCredential>;
    token: string;
    platform: 'instagram' | 'facebook';
  } {
    const summary = getAccountSummary(this.database, account.accountId);
    // The stored platform decides (never the caller's ref). A Page account is refused while the switch is off.
    assertPlatformEnabled(summary.platform, this.options.facebookPagesAvailable);
    const platform = summary.platform === 'facebook' ? 'facebook' : 'instagram';
    const stored = getAccountCredential(this.database, account.accountId);
    if (stored.connectionId !== account.connectionId || stored.providerAccountId !== account.providerAccountId) {
      throw new Error('Account reference does not match its stored owner');
    }
    const connectionSummary = getConnectionSummary(this.database, account.connectionId);
    if (summary.status !== 'valid' || connectionSummary.status !== 'valid' || connectionSummary.deleted_at) {
      throw new Error('Account or connection is not currently validated');
    }

    const connection = getConnectionCredential(this.database, account.connectionId);
    const token = connection.loginKind === 'facebook_login'
      ? stored.secret ? this.vault.decrypt(`account:${account.accountId}`, stored.secret) : ''
      : this.vault.decrypt(account.connectionId, connection.secret);
    if (!token) throw new Error('Validated account credential is unavailable');
    // Page endpoints only exist on graph.facebook.com with a Page token.
    if (platform === 'facebook' && connection.loginKind !== 'facebook_login') throw new PlatformNotSupportedError();
    return { connection, token, platform };
  }

  private assertMediaBelongsToAccount(accountId: string, mediaId: string): void {
    const found = this.database.prepare(`SELECT 1 FROM media WHERE account_id = ? AND media_id = ?`)
      .get(accountId, mediaId);
    if (!found) throw new Error('Media does not belong to this account');
  }

  private assertCommentBelongsToAccount(accountId: string, commentId: string): void {
    const found = this.database.prepare(`SELECT 1 FROM comments WHERE account_id = ? AND comment_id = ?`)
      .get(accountId, commentId);
    if (!found) throw new Error('Comment does not belong to this account');
  }

  private async collectItems<T>(
    loginKind: 'instagram_login' | 'facebook_login',
    version: string,
    firstPath: string,
    token: string,
    cursor: string | undefined,
    mapItem: (item: MetaObject) => T,
    pageLimit = PAGE_LIMIT,
  ): Promise<ProviderPage<T>> {
    const items: T[] = [];
    const seenCursors = new Set<string>();
    let requestCursor = cursor;
    let resumeCursor: string | undefined;
    let complete = true;
    let stopReason: string | undefined;

    if (cursor !== undefined && !validCursor(cursor)) {
      return { items, complete: false, stopReason: 'unsafe_or_missing_cursor' };
    }

    for (let pageNumber = 0; pageNumber < pageLimit; pageNumber++) {
      const path = requestCursor ? appendAfter(firstPath, requestCursor) : firstPath;
      let response: MetaObject;
      try {
        response = await this.request(loginKind, version, path, token);
      } catch (error) {
        complete = false;
        stopReason = safeCode(error);
        resumeCursor = requestCursor;
        break;
      }

      if (!Array.isArray(response.data)) {
        complete = false;
        stopReason = 'invalid_provider_response';
        resumeCursor = requestCursor;
        break;
      }

      let malformedItem = false;
      for (const item of response.data) {
        if (!isObject(item)) {
          malformedItem = true;
          continue;
        }
        try {
          items.push(mapItem(item));
        } catch {
          malformedItem = true;
        }
      }
      if (malformedItem) {
        complete = false;
        stopReason = 'invalid_provider_item';
        resumeCursor = requestCursor;
        break;
      }

      const next = extractPageCursor(response, META_HOSTS[loginKind], `/${version}/`);
      if (next.kind === 'none') {
        requestCursor = undefined;
        break;
      }
      if (next.kind === 'unsafe' || seenCursors.has(next.cursor)) {
        complete = false;
        stopReason = 'unsafe_or_missing_cursor';
        break;
      }

      seenCursors.add(next.cursor);
      requestCursor = next.cursor;
      if (pageNumber === pageLimit - 1) {
        complete = false;
        stopReason = 'page_limit_reached';
        resumeCursor = requestCursor;
      }
    }

    return {
      items,
      complete,
      ...(resumeCursor ? { nextCursor: resumeCursor } : {}),
      ...(stopReason ? { stopReason } : {}),
    };
  }

  private async collectPages(version: string, firstPath: string, token: string): Promise<MetaObject[]> {
    const rows: MetaObject[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    for (let pageNumber = 0; pageNumber < PAGE_LIMIT; pageNumber++) {
      const path = cursor ? appendAfter(firstPath, cursor) : firstPath;
      const response = await this.request('facebook_login', version, path, token);
      if (!Array.isArray(response.data) || !response.data.every(isObject)) {
        throw new MetaSafeError('meta_invalid_provider_response');
      }
      rows.push(...response.data);

      const next = extractCursor(object(response.paging)?.next, META_HOSTS.facebook_login, `/${version}/`);
      if (next.kind === 'none') return rows;
      if (next.kind === 'unsafe' || seenCursors.has(next.cursor)) {
        throw new MetaSafeError('meta_unsafe_pagination');
      }
      seenCursors.add(next.cursor);
      cursor = next.cursor;
      if (pageNumber === PAGE_LIMIT - 1) throw new MetaSafeError('meta_page_limit');
    }
    throw new MetaSafeError('meta_page_limit');
  }

  private async request(
    loginKind: 'instagram_login' | 'facebook_login',
    version: string,
    path: string,
    token: string,
    options: RequestInit = {},
  ): Promise<MetaObject> {
    if (!/^v\d+\.\d+$/.test(version) || !path.startsWith('/') || path.startsWith('//')) {
      throw new MetaSafeError('meta_invalid_request');
    }
    const url = new URL(`${version}${path}`, META_HOSTS[loginKind]);
    if (url.origin !== META_HOSTS[loginKind]) throw new MetaSafeError('meta_invalid_request');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(url, {
        ...options,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          ...(options.headers ?? {}),
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
      });
      const raw = await readBounded(response, BODY_LIMIT);
      const usageHeaders = readSafeUsageHeaders(response.headers);
      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        throw new MetaSafeError('meta_invalid_response', response.status);
      }
      if (!response.ok) {
        const error = metaError(decoded, response.status);
        error.usageHeaders = usageHeaders;
        throw error;
      }
      if (!isObject(decoded)) throw new MetaSafeError('meta_invalid_response', response.status);
      return { ...decoded, __safe_usage: usageHeaders };
    } catch (error) {
      if (error instanceof MetaSafeError) throw error;
      const code = error instanceof Error && error.name === 'AbortError'
        ? 'meta_timeout'
        : 'meta_network_error';
      throw new MetaSafeError(code);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class MetaProviderFactory {
  constructor(
    private readonly database: DatabaseSync,
    private readonly vault: CredentialVault,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  forConnection(_connectionId: string): MetaProvider {
    return new MetaProvider(this.database, this.vault, this.fetcher);
  }
}

export interface ReadbackDiagnostics {
  idMatches: boolean; senderIdMatches: boolean; usernamePresent: boolean; usernameMatches: boolean; recipientCount: number;
  toShape: 'array' | 'data' | 'other' | 'missing'; hasAttachments: boolean; attachmentsShape: 'array' | 'data' | 'missing' | 'other';
}

class MetaSafeError extends Error {
  diagnostics?: ReadbackDiagnostics;
  /** True when Meta's error message says user consent is required (the message itself is never kept). */
  consentRequired?: boolean;
  /** Bounded type-checked subset of Meta's error object (message is redacted by the profile diagnostic before exposure). */
  details?: MetaErrorDetails;
  usageHeaders?: { appUsage?: string; pageUsage?: string; retryAfter?: string };
  constructor(
    readonly code: string,
    readonly httpStatus?: number,
    readonly metaCode?: number,
    readonly metaSubcode?: number,
  ) {
    super(code);
  }
}

function invalidValidation(error: unknown): ConnectionValidation {
  const safeError = error instanceof MetaSafeError ? error : undefined;
  const safeErrorCode = safeError?.metaCode
    ? `meta_${safeError.metaCode}${safeError.metaSubcode ? `_${safeError.metaSubcode}` : ''}`
    : safeError?.code ?? 'meta_error';
  return { status: 'invalid', observedAt: new Date().toISOString(), capabilities: [], safeErrorCode };
}

function sendFailure(error: unknown): SendResult {
  const safeError = error instanceof MetaSafeError ? error : undefined;
  const safeErrorCode = safeError?.metaCode
    ? `meta_${safeError.metaCode}${safeError.metaSubcode ? `_${safeError.metaSubcode}` : ''}`
    : safeError?.code ?? 'meta_error';
  return {
    outcome: safeError?.httpStatus && safeError.httpStatus >= 400 && safeError.httpStatus < 500
      ? 'definitive_rejection'
      : 'ambiguous',
    safeErrorCode,
    httpStatus: safeError?.httpStatus,
    metaCode: safeError?.metaCode,
    metaSubcode: safeError?.metaSubcode,
    usageHeaders: safeError?.usageHeaders,
  };
}

/** Fields read for every Facebook comment (verified live): author only when the person has a role on the app. */
const FACEBOOK_COMMENT_FIELDS = 'id,message,created_time,from,can_reply_privately,can_comment,is_hidden,parent{id}';

/**
 * Maps a Facebook comment. `from` is absent for people without a role on the app: then username and authorId stay
 * undefined (never guessed). `from.name` is a display name, not a handle; it only feeds `{{username}}`.
 */
function facebookComment(item: MetaObject): ProviderComment {
  const from = object(item.from);
  const name = string(from?.name)?.trim();
  return {
    commentId: requiredString(item.id),
    text: string(item.message),
    username: name ? name : undefined,
    createdAt: string(item.created_time),
    parentId: string(object(item.parent)?.id),
    authorId: opaqueId(from?.id),
    canReplyPrivately: typeof item.can_reply_privately === 'boolean' ? item.can_reply_privately : undefined,
  };
}

/** Meta error subcodes (docs-based, not all verified live) for private replies to a comment. */
const FACEBOOK_WINDOW_CLOSED = new Set(['10/2534022', '10/2018278']);
const FACEBOOK_RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001]);

/**
 * Facebook private-reply failure. 4xx = definitive (provably not sent); timeouts, network errors, 5xx and malformed
 * bodies stay ambiguous (UNKNOWN_OUTCOME, never retried). Documented codes get stable names:
 * 100/2534025 comment not valid for a private reply, 10/2534022 and 10/2018278 window closed, 200-299 permission,
 * 551 recipient cannot receive messages, 4/17/32/613/80001 throttling (retryable), 190 invalid or expired token.
 */
function facebookSendFailure(error: unknown): SendResult {
  const base = sendFailure(error);
  const safeError = error instanceof MetaSafeError ? error : undefined;
  if (base.outcome !== 'definitive_rejection' || safeError?.code !== 'meta_api_error') return base;
  const code = safeError.metaCode;
  const subcode = safeError.metaSubcode;
  const throttled = base.httpStatus === 429 || (code !== undefined && FACEBOOK_RATE_LIMIT_CODES.has(code));
  const safeErrorCode = code === 190 ? 'facebook_token_invalid'
    : throttled ? 'facebook_rate_limited'
      : code === 100 && subcode === 2534025 ? 'comment_not_valid_for_private_reply'
        : code !== undefined && FACEBOOK_WINDOW_CLOSED.has(`${code}/${subcode}`) ? 'private_reply_window_closed'
          : code === 551 ? 'recipient_cannot_receive_messages'
            : code !== undefined && (code === 10 || code === 3 || code === 102 || (code >= 200 && code <= 299)) ? 'facebook_permission_denied'
              : base.safeErrorCode;
  return { ...base, safeErrorCode, ...(throttled ? { rateLimited: true } : {}) };
}

const PUBLIC_REPLY_MESSAGE_MAX = 1000;
/** Graph API permission/OAuth error codes: 3 capability, 10 permission denied, 102/190 session/token, 200-299 permissions. */
const PERMISSION_CODES = new Set([3, 10, 102, 190]);
/** Graph API throttling codes: 4 app, 17 user, 32 page, 613 custom rate limit. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/**
 * A 4xx response is a definitive rejection (provably not published). Permission/OAuth errors map to
 * `public_reply_permission_denied`, throttling (Meta codes or HTTP 429) to `public_reply_rate_limited`.
 * Server errors, timeouts, network/redirect failures and malformed bodies are ambiguous.
 */
function publicReplyFailure(error: unknown): PublicReplyResult {
  const safeError = error instanceof MetaSafeError ? error : undefined;
  const status = safeError?.httpStatus;
  const code = safeError?.metaCode;
  if (!status || status < 400 || status >= 500 || safeError.code !== 'meta_api_error') {
    return { outcome: 'ambiguous', safeErrorCode: safeError?.code ?? 'meta_error', httpStatus: status, usageHeaders: safeError?.usageHeaders };
  }
  const safeErrorCode = code !== undefined && (PERMISSION_CODES.has(code) || (code >= 200 && code <= 299))
    ? 'public_reply_permission_denied'
    : status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code)) ? 'public_reply_rate_limited'
      : code !== undefined ? `meta_${code}` : `http_${status}`;
  return { outcome: 'definitive_rejection', safeErrorCode, httpStatus: status, metaCode: code, usageHeaders: safeError.usageHeaders };
}


function moderationFailure(error: unknown): ModerationResult {
  const safeError = error instanceof MetaSafeError ? error : undefined;
  const status = safeError?.httpStatus;
  const code = safeError?.metaCode;
  if (!status || status < 400 || status >= 500 || safeError.code !== 'meta_api_error') {
    return { status: 'ambiguous', safeErrorCode: safeError?.code ?? 'meta_error' };
  }
  const safeErrorCode = status === 404 || code === 100 ? 'moderation_not_found'
    : code !== undefined && (PERMISSION_CODES.has(code) || (code >= 200 && code <= 299)) ? 'moderation_permission_denied'
    : status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code)) ? 'moderation_rate_limited'
    : 'moderation_rejected';
  return { status: 'rejected', safeErrorCode };
}
function readSafeUsageHeaders(headers: Headers): { appUsage?: string; pageUsage?: string; retryAfter?: string } {
  const appUsage = sanitizeUsageValue(headers.get('x-app-usage'));
  const pageUsage = sanitizeUsageValue(headers.get('x-page-usage'));
  const retryAfter = sanitizeRetryAfter(headers.get('retry-after'));
  return {
    ...(appUsage ? { appUsage } : {}),
    ...(pageUsage ? { pageUsage } : {}),
    ...(retryAfter ? { retryAfter } : {}),
  };
}

function safeUsage(value: MetaObject | undefined): { appUsage?: string; pageUsage?: string; retryAfter?: string } | undefined {
  if (!value) return undefined;
  const appUsage = string(value.appUsage);
  const pageUsage = string(value.pageUsage);
  const retryAfter = string(value.retryAfter);
  if (!appUsage && !pageUsage && !retryAfter) return undefined;
  return { ...(appUsage ? { appUsage } : {}), ...(pageUsage ? { pageUsage } : {}), ...(retryAfter ? { retryAfter } : {}) };
}

function sanitizeUsageValue(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length > 256 || /[\r\n]/u.test(trimmed) || /bearer|access_token|password/iu.test(trimmed)) return undefined;
  return trimmed;
}

function sanitizeRetryAfter(value: string | null): string | undefined {
  const safe = sanitizeUsageValue(value);
  if (!safe) return undefined;
  if (/^\d{1,6}$/u.test(safe)) return safe;
  return Number.isFinite(Date.parse(safe)) ? safe : undefined;
}

function metaError(body: unknown, status: number): MetaSafeError {
  const error = object(object(body)?.error);
  const safe = new MetaSafeError('meta_api_error', status, number(error?.code), number(error?.error_subcode));
  const message = string(error?.message);
  if (message && /user consent is required/iu.test(message.slice(0, 500))) safe.consentRequired = true;
  const type = string(error?.type);
  const trace = string(error?.fbtrace_id);
  const details: MetaErrorDetails = {
    httpStatus: status,
    ...(number(error?.code) !== undefined ? { code: number(error?.code) } : {}),
    ...(number(error?.error_subcode) !== undefined ? { subcode: number(error?.error_subcode) } : {}),
    ...(type ? { type: type.slice(0, 60) } : {}),
    ...(message ? { message: message.slice(0, 2000) } : {}),
    ...(trace ? { fbtraceId: trace.slice(0, 40) } : {}),
  };
  safe.details = details;
  return safe;
}

const PROFILE_FIELDS = 'name,username,is_user_follow_business,is_business_follow_user';

/** Redacts bearer/token-like content from a Meta error message, then bounds it to 200 characters. */
function redactMetaMessage(message: string, token: string): string {
  return redactSecrets(message, [token])
    .replace(/\b(?:access_)?token=[^\s&"']+/giu, (match) => `${match.slice(0, match.indexOf('=') + 1)}[REDACTED]`)
    .replace(/\b[0-9a-f]{20,}\b/giu, '[REDACTED]')
    .replace(/[A-Za-z0-9_-]{30,}/gu, '[REDACTED]')
    .slice(0, 200);
}

/**
 * EXPERIMENTAL interactive payload failure: an explicit 400 from Meta (other than token/permission or throttling codes)
 * means the new shape was rejected; it is definitive and never retried. 429/throttling keeps its retryable status;
 * timeouts, network errors, 5xx and malformed bodies stay ambiguous (UNKNOWN_OUTCOME, never retried).
 */
function interactiveSendFailure(error: unknown): SendResult {
  const base = sendFailure(error);
  const safeError = error instanceof MetaSafeError ? error : undefined;
  const code = safeError?.metaCode;
  const tokenOrPermission = code !== undefined && (PERMISSION_CODES.has(code) || (code >= 200 && code <= 299));
  const throttled = code !== undefined && RATE_LIMIT_CODES.has(code);
  if (base.outcome === 'definitive_rejection' && safeError?.code === 'meta_api_error' && safeError.httpStatus === 400
    && !tokenOrPermission && !throttled) {
    return { ...base, safeErrorCode: 'interactive_payload_rejected' };
  }
  return base;
}

const DIAGNOSTIC_MAX_MESSAGES = 20;
const DIAGNOSTIC_SPACING_MS = 500;
const DIAGNOSTIC_TEXT_MAX = 80;
const DIAGNOSTIC_MAX_KEYS = 30;

/** Opaque provider id (IGSID, conversation or message id): bounded and URL-safe characters only. */
function opaqueId(value: unknown, maximum = 64): string | undefined {
  if (typeof value !== 'string') return undefined;
  const pattern = maximum === 64 ? /^[A-Za-z0-9_-]{1,64}$/u : /^[A-Za-z0-9_\-=.:]{1,256}$/u;
  return pattern.test(value) && !value.includes('..') ? value : undefined;
}

function commentAuthorId(item: MetaObject): string | undefined {
  return opaqueId(object(item.from)?.id);
}

function safeMetaCode(error: unknown): string {
  const safeError = error instanceof MetaSafeError ? error : undefined;
  if (safeError?.metaCode) return `meta_${safeError.metaCode}${safeError.metaSubcode ? `_${safeError.metaSubcode}` : ''}`;
  return safeError?.code ?? 'meta_error';
}

/** Bounded summary of one raw message: names of its top-level keys, never their values (except truncated text). */
function summarizeMessage(id: string, raw: MetaObject, account: AccountRef): DiagnosticMessage {
  const keys = Object.keys(raw).filter((key) => key !== '__safe_usage' && /^[a-z0-9_]{1,40}$/u.test(key)).sort().slice(0, DIAGNOSTIC_MAX_KEYS);
  const sender = object(raw.from);
  const senderId = string(sender?.id);
  const senderUsername = string(sender?.username);
  const direction: DiagnosticMessage['direction'] = !sender ? 'unknown'
    : senderId === account.providerAccountId || (senderUsername !== undefined && senderUsername.trim() !== ''
      && normalizeMatchText(senderUsername) === normalizeMatchText(account.username)) ? 'account' : 'user';
  const text = string(raw.message);
  const createdTime = string(raw.created_time)?.slice(0, 40);
  const attachments = raw.attachments;
  const attachmentsObject = object(attachments);
  return {
    id,
    ...(createdTime ? { createdTime } : {}),
    direction,
    ...(text !== undefined ? { text: Array.from(text).slice(0, DIAGNOSTIC_TEXT_MAX).join('') } : {}),
    keys,
    attachmentsShape: Array.isArray(attachments) ? 'array'
      : attachmentsObject && Array.isArray(attachmentsObject.data) ? 'data'
        : attachments === undefined || attachments === null ? 'missing' : 'other',
  };
}

async function readBounded(response: Response, maximumBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new MetaSafeError('meta_response_too_large', response.status);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function extractCursor(next: unknown, origin: string, pathPrefix: string): CursorResult {
  if (next === undefined) return { kind: 'none' };
  if (typeof next !== 'string' || !next) return { kind: 'unsafe' };
  try {
    const url = new URL(next);
    if (url.origin !== origin || !url.pathname.startsWith(pathPrefix)) return { kind: 'unsafe' };
    const after = url.searchParams.get('after');
    return after && validCursor(after) ? { kind: 'cursor', cursor: after } : { kind: 'unsafe' };
  } catch {
    return { kind: 'unsafe' };
  }
}

function extractPageCursor(response: MetaObject, origin: string, pathPrefix: string): CursorResult {
  if (!Object.hasOwn(response, 'paging')) return { kind: 'none' };
  const paging = object(response.paging);
  if (!paging) return { kind: 'unsafe' };
  if (!Object.hasOwn(paging, 'next')) return { kind: 'none' };
  return extractCursor(paging.next, origin, pathPrefix);
}

function appendAfter(path: string, cursor: string): string {
  const [base, query] = path.split('?');
  const parameters = new URLSearchParams(query ?? '');
  parameters.set('after', cursor);
  return `${base}?${parameters.toString()}`;
}

function validCursor(cursor: string): boolean {
  return cursor.trim().length > 0 && cursor.length <= 2048;
}

/** EXPERIMENTAL interactive buttons: 1-3 distinct titles (1-20 chars, no links) with server-generated payloads. */
function validInteractiveButtons(value: unknown): value is Array<{ title: string; payload: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > INTERACTIVE_MAX_BUTTONS) return false;
  const valid = value.every((button) => isObject(button) && typeof button.title === 'string' && button.title.trim() !== ''
    && Array.from(button.title).length <= INTERACTIVE_TITLE_MAX && !looksLikeUrl(button.title)
    && typeof button.payload === 'string' && INTERACTIVE_PAYLOAD_PATTERN.test(button.payload));
  return valid && new Set(value.map((button) => normalizeMatchText((button as { title: string }).title))).size === value.length;
}

function validPrivateReplyPayload(payload: PrivateReplyPayload): boolean {
  if (!payload || typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 1000
    || !Array.isArray(payload.buttons) || payload.buttons.length > 2) return false;
  // Retired experiment: quick replies are never sent again (fail closed before any request).
  if (payload.quickReplies !== undefined) return false;
  if (payload.postbackButtons !== undefined) {
    if (!validInteractiveButtons(payload.postbackButtons) || payload.buttons.length + payload.postbackButtons.length > INTERACTIVE_MAX_BUTTONS) return false;
  }
  return payload.buttons.every((button) => {
    if (!button || typeof button.title !== 'string' || !button.title.trim() || button.title.length > 20
      || typeof button.url !== 'string') return false;
    try {
      const url = new URL(button.url);
      return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  });
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const MEDIA_CAPTION_MAX = 200;
const MEDIA_TYPES: readonly MediaType[] = ['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'];

/** Display-only caption: non-blank string, truncated by code points to a safe length. */
function mediaCaption(value: unknown): string | undefined {
  const text = string(value);
  if (!text || !text.trim()) return undefined;
  const points = Array.from(text);
  return points.length > MEDIA_CAPTION_MAX ? points.slice(0, MEDIA_CAPTION_MAX).join('') : text;
}

function mediaType(value: unknown): MediaType | undefined {
  return MEDIA_TYPES.find((known) => known === value);
}

/** Meta often omits top-level `username` and carries the author in `from`. */
function commentAuthor(item: MetaObject): string | undefined {
  const top = string(item.username);
  if (top?.trim()) return top;
  const fromUsername = string(object(item.from)?.username);
  return fromUsername?.trim() ? fromUsername : undefined;
}

function requiredString(value: unknown): string {
  const result = string(value);
  if (!result) throw new MetaSafeError('meta_invalid_response');
  return result;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isObject(value: unknown): value is MetaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown): MetaObject | undefined {
  return isObject(value) ? value : undefined;
}

function safeCode(error: unknown): string {
  return error instanceof MetaSafeError ? error.code : 'meta_error';
}

function parseThumbnailUrl(thumbnailUrl: unknown, mediaUrl: unknown): string | undefined {
  for (const candidate of [string(thumbnailUrl), string(mediaUrl)]) {
    if (!candidate || candidate.length > 2048) continue;
    try {
      if (new URL(candidate).protocol === 'https:') return candidate;
    } catch {
      // Not a URL: try the next candidate.
    }
  }
  return undefined;
}
