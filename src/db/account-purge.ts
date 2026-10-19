import type { DatabaseSync } from 'node:sqlite';
import { DomainRejectionError } from '../core/errors.ts';

/**
 * Hard delete of one account and everything that references it. Everything is derived from the live schema
 * (PRAGMA table_info / foreign_key_list / sqlite_master), never from a hand-kept table list, so a table added by a
 * future migration is covered (or, if it is append-only, protects the history) without touching this file.
 */

const ACCOUNTS_TABLE = 'social_accounts';

function quote(name: string): string { return `"${name.replace(/"/gu, '""')}"`; }

function tableNames(database: DatabaseSync): string[] {
  return (database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

type ForeignKey = { table: string; from: string; to: string | null };

function foreignKeys(database: DatabaseSync, table: string): ForeignKey[] {
  return database.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all() as ForeignKey[];
}

/** Column that scopes `table` to an account: `account_id`, or a foreign key to social_accounts. */
function accountColumn(database: DatabaseSync, table: string): string | null {
  const columns = (database.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{ name: string }>).map((column) => column.name);
  if (columns.includes('account_id')) return 'account_id';
  return foreignKeys(database, table).find((key) => key.table === ACCOUNTS_TABLE)?.from ?? null;
}

/** Every table (except social_accounts itself) that holds rows of an account, with its scoping column. */
function scopedTables(database: DatabaseSync): Array<{ table: string; column: string }> {
  const result: Array<{ table: string; column: string }> = [];
  for (const table of tableNames(database)) {
    if (table === ACCOUNTS_TABLE) continue;
    const column = accountColumn(database, table);
    if (column) result.push({ table, column });
  }
  return result;
}

/**
 * Tables that hold the send history: those protected by a delete-blocking trigger (append-only logs) plus the
 * parents they reference (the queue and the gate sessions, protected through ON DELETE RESTRICT).
 */
function historyTables(database: DatabaseSync): Set<string> {
  const protectedTables = new Set<string>();
  const triggers = database.prepare(`SELECT tbl_name, sql FROM sqlite_master WHERE type = 'trigger'`).all() as Array<{ tbl_name: string; sql: string | null }>;
  for (const trigger of triggers) {
    if (trigger.sql && /BEFORE\s+DELETE/iu.test(trigger.sql) && /RAISE\s*\(/iu.test(trigger.sql)) protectedTables.add(trigger.tbl_name);
  }
  for (const table of [...protectedTables]) {
    for (const key of foreignKeys(database, table)) if (key.table !== ACCOUNTS_TABLE) protectedTables.add(key.table);
  }
  return protectedTables;
}

/** True when the account has any row in a send-history table (queue, attempts, gate events, moderation actions). */
export function accountHasSendHistory(database: DatabaseSync, accountId: string): boolean {
  const history = historyTables(database);
  for (const { table, column } of scopedTables(database)) {
    if (!history.has(table)) continue;
    if (database.prepare(`SELECT 1 FROM ${quote(table)} WHERE ${quote(column)} = ? LIMIT 1`).get(accountId)) return true;
  }
  return false;
}

/** Children first: a table is deleted only after every table whose foreign keys point at it. */
function deletionOrder(database: DatabaseSync, tables: Array<{ table: string; column: string }>): Array<{ table: string; column: string }> {
  const remaining = new Map(tables.map((entry) => [entry.table, entry]));
  const parentsOf = new Map(tables.map((entry) => [entry.table, new Set(foreignKeys(database, entry.table).map((key) => key.table))]));
  const ordered: Array<{ table: string; column: string }> = [];
  while (remaining.size) {
    const ready = [...remaining.keys()].filter((name) =>
      ![...remaining.keys()].some((other) => other !== name && parentsOf.get(other)!.has(name)));
    if (!ready.length) throw new Error('Cannot order account tables: circular foreign keys');
    for (const name of ready) { ordered.push(remaining.get(name)!); remaining.delete(name); }
  }
  return ordered;
}

/**
 * Deletes a disconnected account without send history, and every row of it in every table, in ONE transaction with
 * foreign keys enforced. If its connection is then disconnected/deleted and owns no other account, the connection
 * tombstone is removed too. Append-only history is never touched: an account that has any is refused untouched.
 */
export function purgeAccount(database: DatabaseSync, accountId: string): { removedConnection: boolean } {
  if ((database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys !== 1) {
    throw new Error('Foreign keys must be enforced to purge an account');
  }
  database.exec('BEGIN IMMEDIATE');
  try {
    const account = database.prepare(`SELECT status, connection_id FROM ${ACCOUNTS_TABLE} WHERE account_id = ?`)
      .get(accountId) as { status: string; connection_id: string } | undefined;
    if (!account) throw new Error('Account not found');
    if (account.status !== 'disconnected') {
      throw new DomainRejectionError('account_not_disconnected', 'Only a disconnected account can be deleted');
    }
    if (accountHasSendHistory(database, accountId)) {
      throw new DomainRejectionError('account_has_send_history', 'The send history of this account is protected and cannot be deleted');
    }

    for (const { table, column } of deletionOrder(database, scopedTables(database))) {
      database.prepare(`DELETE FROM ${quote(table)} WHERE ${quote(column)} = ?`).run(accountId);
    }
    database.prepare(`DELETE FROM ${ACCOUNTS_TABLE} WHERE account_id = ?`).run(accountId);

    let removedConnection = false;
    const remainingAccounts = database.prepare(`SELECT 1 FROM ${ACCOUNTS_TABLE} WHERE connection_id = ? LIMIT 1`).get(account.connection_id);
    if (!remainingAccounts) {
      removedConnection = Number(database.prepare(`DELETE FROM connections WHERE id = ? AND (status = 'disconnected' OR deleted_at IS NOT NULL)`)
        .run(account.connection_id).changes) === 1;
    }
    // Ghost records: connections the user deleted whose accounts are all gone. A connection that was only
    // disconnected (not deleted) stays, because the person may reconnect it with a new token.
    database.prepare(`DELETE FROM connections WHERE deleted_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${ACCOUNTS_TABLE} s WHERE s.connection_id = connections.id)`).run();
    if (database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key check failed after purging the account');
    database.exec('COMMIT');
    return { removedConnection };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
