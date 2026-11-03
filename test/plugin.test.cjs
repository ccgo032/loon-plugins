'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const pluginPath = path.join(__dirname, '..', 'loon', 'ximalaya-splash.plugin');
const plugin = fs.readFileSync(pluginPath, 'utf8');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'synthetic.json'), 'utf8'));

// This extracts the two deliberately limited rule shapes from the actual file.
// It is a scope/fixture checker, NOT a replacement for Loon's native parser.
function parseRule(line) {
  const phase = /^(request|response) if /.exec(line)?.[1];
  const method = /\$\{request\.method\} == "([A-Z]+)"/.exec(line)?.[1];
  const url = /\$\{url\} ~= (\/(?:\\.|[^/])+\/[a-z]*)/.exec(line)?.[1];
  const ua = /\$\{request\.header\['User-Agent'\]\} ~= (\/(?:\\.|[^/])+\/[a-z]*)/.exec(line)?.[1];
  const status = /\$\{response\.status\} == (\d+)/.exec(line)?.[1];
  const separator = line.indexOf(' then ');
  const action = separator < 0 ? null : line.slice(separator + 6);
  if (!phase || !method || !url || !action) throw new Error('Unsupported test rule shape');
  function compile(literal) {
    const end = literal.lastIndexOf('/');
    return new RegExp(literal.slice(1, end), literal.slice(end + 1));
  }
  return { phase, method, url: compile(url), ua: ua && compile(ua), status: status && Number(status), action };
}

const lines = plugin.split(/\r?\n/).filter(line => /^(request|response) if /.test(line));
const rules = lines.map(parseRule);
const requestRule = rules.find(rule => rule.phase === 'request');
const responseRule = rules.find(rule => rule.phase === 'response');

function matches(rule, request) {
  return request.method === rule.method && rule.url.test(request.url)
    && (!rule.ua || rule.ua.test(request.userAgent || ''))
    && (!rule.status || request.status === rule.status);
}

function getJqExpression() {
  const match = /^response\.json\.jq\(("(?:\\.|[^"\\])*")\)$/.exec(responseRule.action);
  assert.ok(match, 'JSON transformation must use one inline JQ expression');
  return JSON.parse(match[1]);
}

function transformWithJq(value, jqBin = process.env.JQ_BIN || 'jq') {
  const result = spawnSync(jqBin, ['-c', getJqExpression()], { input: JSON.stringify(value), encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('plugin has two native rewrites and only two explicit MitM hosts', () => {
  assert.equal(rules.length, 2);
  assert.ok(requestRule && responseRule);
  assert.equal(requestRule.action, 'reject(204)');
  assert.match(plugin, /^#!loon_version = 3\.5\.1\(978\)$/m);
  assert.deepEqual([...plugin.matchAll(/^\[([^\]]+)\]$/gm)].map(m => m[1]), ['Rewrite', 'MitM']);
  const hosts = /^hostname\s*=\s*(.+)$/m.exec(plugin)?.[1].split(',').map(s => s.trim()).sort();
  assert.deepEqual(hosts, ['mobwsa.ximalaya.com', 'tmeadkg.y.qq.com']);
  assert.doesNotMatch(plugin, /\[Script\]|script-path|\.js(?:\?|\s|$)|\$httpClient|mock_file|\[Host\]|\[General\]|\[Rule\]/i);
  assert.doesNotMatch(plugin, /ca-p12|ca-passphrase|114\.114\.114\.114|skip-server-cert-verify/i);
});

test('only the observed Ximalaya SDK request scope is rejected', () => {
  for (const request of fixtures.requestMatches) assert.equal(matches(requestRule, request), true, request.url);
  for (const request of fixtures.requestPassThrough) assert.equal(matches(requestRule, request), false, request.url);
});

test('response rewrite matches only the exact successful advertising-control endpoint', () => {
  for (const response of fixtures.responseMatches) assert.equal(matches(responseRule, response), true, response.url);
  for (const response of fixtures.responsePassThrough) assert.equal(matches(responseRule, response), false, response.url);
});

test('JQ uses schema guards and has no external inputs or execution', () => {
  const jq = getJqExpression();
  assert.match(jq, /type == "object"/);
  assert.match(jq, /\.ret == 0/);
  assert.match(jq, /\.data\.isAdShow == true/);
  assert.doesNotMatch(jq, /\b(?:input|inputs|env|include|import|module|debug|stderr)\b|https?:\/\//);
});

const jqProbe = spawnSync(process.env.JQ_BIN || 'jq', ['--version'], { encoding: 'utf8', windowsHide: true });
test('actual JQ preserves errors and unrelated fields', { skip: jqProbe.status !== 0 ? 'Install jq or set JQ_BIN to run transformation fixtures' : false }, async t => {
  for (const fixture of fixtures.jsonTransform) {
    await t.test(fixture.name, () => assert.deepEqual(transformWithJq(fixture.input), fixture.expected));
  }
});

module.exports = { rules, matches, transformWithJq, getJqExpression };
