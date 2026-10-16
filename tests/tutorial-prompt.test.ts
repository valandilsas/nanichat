import assert from 'node:assert/strict';
import test from 'node:test';
import { SAFETY_RULES, TUTORIALS } from '../app/tutorial/content.ts';
import { buildHelpPrompt } from '../app/tutorial/prompt.ts';

const DUMMY_APP_ID = '1234567890123';
const cases = (Object.keys(TUTORIALS) as Array<keyof typeof TUTORIALS>).flatMap((platform) =>
  TUTORIALS[platform].steps.map((step, index, steps) => ({ platform, step, index, total: steps.length, prompt: buildHelpPrompt(platform, step, index, steps.length) })));

test('every generated prompt names the step, its goal, all instructions, the expected result and the placeholders', () => {
  for (const { platform, step, index, total, prompt } of cases) {
    const where = `${platform}/${step.id}`;
    assert.ok(prompt.includes(`Paso en el que estoy: ${index + 1} de ${total} — «${step.title}»`), where);
    assert.ok(prompt.includes('Qué debo lograr en este paso:'), where);
    assert.ok(prompt.includes('Qué se supone que debo hacer:'), where);
    step.instructions.forEach((line, position) => {
      const neutral = line.replace(/Social Desk|NaniChat/gu, 'mi programa local');
      assert.ok(prompt.includes(`${position + 1}. ${neutral}`), `${where}: instruction ${position + 1}`);
    });
    assert.ok(prompt.includes('Cómo sé que salió bien:'), where);
    assert.ok(prompt.includes(step.expectedResult.replace(/^Sabrás que está bien cuando/u, 'Sé que salió bien cuando')), where);
    assert.ok(prompt.includes('Mi panel de Meta está en español.'), where);
    for (const label of ['Dónde me quedé / qué veo en pantalla: [REEMPLAZA: describe en qué pantalla estás y qué ves]', 'Mensaje de error exacto (sin tokens ni secretos): [REEMPLAZA: pega el texto del error o escribe «ninguno»]', 'Qué ya intenté: [REEMPLAZA: ', 'Tipo de cuenta o rol que tengo: [REEMPLAZA: ']) assert.ok(prompt.includes(label), `${where}: ${label.slice(0, 20)}`);
    assert.ok(prompt.includes('Antes de responder, pídeme los datos que falten. Ayúdame solo con este paso, un sub-paso a la vez.'), where);
    assert.ok(prompt.includes(`«${step.title}»`), where);
    step.notes.forEach((note) => assert.ok(prompt.includes(note.replace(/Social Desk|NaniChat/gu, 'mi programa local')), `${where}: warning`));
  }
});

test('every prompt carries the three mandatory safety rules', () => {
  assert.equal(SAFETY_RULES.length, 3);
  for (const { platform, step, prompt } of cases) {
    for (const rule of SAFETY_RULES) assert.ok(prompt.includes(rule), `${platform}/${step.id}: ${rule.slice(0, 30)}`);
    assert.match(prompt, /Nunca me pidas ni aceptes tokens/u);
    assert.match(prompt, /documentación oficial de Meta/u);
    assert.match(prompt, /un solo paso a la vez/u);
  }
});

test('prompts never name the product or call it an automation app', () => {
  for (const { platform, step, prompt } of cases) {
    assert.doesNotMatch(prompt, /social desk|nanichat|automatización social|aplicación local/iu, `${platform}/${step.id}`);
  }
});

test('the platform decides the account type and Instagram or Facebook is named correctly', () => {
  for (const { platform, prompt } of cases) {
    if (platform === 'instagram') {
      assert.match(prompt, /Meta para Instagram\./u);
      assert.match(prompt, /mi cuenta profesional de Instagram/u);
      assert.doesNotMatch(prompt, /Página de Facebook y responderlos/u);
    } else {
      assert.match(prompt, /Meta para Facebook\./u);
      assert.match(prompt, /mi Página de Facebook y responderlos por mensaje privado desde un programa propio/u);
    }
    assert.match(prompt, /obtener un token de acceso y los permisos necesarios para poder leer los comentarios de las publicaciones de mi /u);
  }
});

test('steps flagged as unverified tell the AI the step is unconfirmed and ask it to verify against the docs', () => {
  for (const { platform, step, prompt } of cases) {
    const where = `${platform}/${step.id}`;
    if (step.verified) assert.doesNotMatch(prompt, /NO está confirmado/u, where);
    else {
      assert.match(prompt, /Este paso NO está confirmado/u, where);
      assert.match(prompt, /documentación oficial de Meta y dime/u, where);
    }
  }
  assert.ok(cases.some(({ step }) => !step.verified));
});

test('steps inside the local program refer to it generically, by its screen labels', () => {
  const local = cases.filter(({ step }) => step.local);
  assert.ok(local.length >= 5);
  for (const { platform, step, prompt } of local) {
    assert.match(prompt, /mi programa local/u, `${platform}/${step.id}`);
    assert.match(prompt, /no en el sitio de Meta/u, `${platform}/${step.id}`);
  }
  const paste = cases.find(({ platform, step }) => platform === 'instagram' && step.id === 'pegar-token')!;
  assert.match(paste.prompt, /«Nueva conexión»/u);
  const discover = cases.find(({ platform, step }) => platform === 'facebook' && step.id === 'probar-seleccionar')!;
  assert.match(discover.prompt, /«Probar y descubrir»/u);
});

test('the where-line lists link labels with their urls, resolves the app id when known and never leaks a template', () => {
  const permisos = cases.find(({ platform, step }) => platform === 'facebook' && step.id === 'permisos')!;
  assert.doesNotMatch(permisos.prompt, /\{APP_ID\}/u);
  assert.match(permisos.prompt, /Dónde se hace: /u);
  assert.match(permisos.prompt, /https:\/\/developers\.facebook\.com\/documentation\/development\/permissions/u);
  const withId = buildHelpPrompt('facebook', permisos.step, permisos.index, permisos.total, DUMMY_APP_ID);
  assert.ok(withId.includes(`https://developers.facebook.com/apps/${DUMMY_APP_ID}/use_cases/customize/?use_case_enum=PAGES_API`));
  assert.doesNotMatch(withId, /\{APP_ID\}/u);
  assert.doesNotMatch(permisos.prompt, new RegExp(DUMMY_APP_ID, 'u'));
});
