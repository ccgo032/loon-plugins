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

function getJqExpression(rule = responseRule) {
  const match = /^response\.json\.jq\(("(?:\\.|[^"\\])*")\)(?: \| response\.header\.set\("X-Loon-Ximalaya-Filter", "v2"\))?$/.exec(rule.action);
  assert.ok(match, 'JSON transformation must use one inline JQ expression');
  return JSON.parse(match[1]);
}

function transformWithJq(value, jqBin = process.env.JQ_BIN || 'jq', rule = responseRule) {
  const result = spawnSync(jqBin, ['-c', getJqExpression(rule)], { input: JSON.stringify(value), encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('v2 has five native rewrites, four ad domains and three explicit MitM hosts', () => {
  assert.equal(rules.length, 5);
  assert.ok(requestRule && responseRule);
  assert.equal(requestRule.action, 'reject(204)');
  assert.match(plugin, /^#!loon_version = 3\.5\.1\(978\)$/m);
  assert.deepEqual([...plugin.matchAll(/^\[([^\]]+)\]$/gm)].map(m => m[1]), ['Rule', 'Rewrite', 'MitM']);
  const hosts = /^hostname\s*=\s*(.+)$/m.exec(plugin)?.[1].split(',').map(s => s.trim()).sort();
  assert.deepEqual(hosts, ['mobile.ximalaya.com', 'mobwsa.ximalaya.com', 'tmeadkg.y.qq.com']);
  assert.deepEqual(plugin.match(/^DOMAIN,.+,REJECT$/gm), ['DOMAIN,adse.ximalaya.com,REJECT','DOMAIN,adse.wsa.ximalaya.com,REJECT','DOMAIN,adse.test.ximalaya.com,REJECT','DOMAIN,adsebs.ximalaya.com,REJECT']);
  assert.doesNotMatch(plugin, /\[Script\]|script-path|\.js(?:\?|\s|$)|\$httpClient|mock_file|\[Host\]|\[General\]|IP-CIDR|DOMAIN-SUFFIX/i);
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

function endpointRule(fragment) {
  return rules.find(r => r.phase === 'response' && r.url.test('https://' + fragment));
}

test('new configuration rewrites exclude unrelated methods, hosts and paths', () => {
  const endpoints = [
    ['GET','mobwsa.ximalaya.com/mobile_switch_ios/synthetic'],
    ['POST','mobwsa.ximalaya.com/abtest-portal/sync/synthetic'],
    ['POST','mobile.ximalaya.com/firework-portal/v12/sync'],
  ];
  for (const [method,endpoint] of endpoints) {
    const rule = endpointRule(endpoint);
    assert.ok(rule);
    assert.equal(matches(rule,{method,url:'https://'+endpoint+'?test=synthetic',status:200}),true);
    for (const bad of [
      {method:method==='POST'?'GET':'POST',url:'https://'+endpoint,status:200},
      {method,url:'https://'+endpoint,status:500},
      {method,url:'https://sub.'+endpoint,status:200},
      {method,url:'https://'+endpoint+'/extra',status:200},
      {method,url:'https://mobwsa.ximalaya.com/business-vip-center-mobile-web/user/vip-info',status:200},
    ]) assert.equal(matches(rule,bad),false);
  }
});

test('v2 changes only the selected feature and explicit ad plans', { skip: jqProbe.status !== 0 ? 'Install jq or set JQ_BIN' : false }, () => {
  const convert=(value,endpoint)=>transformWithJq(value,process.env.JQ_BIN||'jq',endpointRule(endpoint));
  const dns='mobwsa.ximalaya.com/mobile_switch_ios/synthetic';
  assert.deepEqual(convert({enableHttpdns:true,other:true},dns),{enableHttpdns:false,other:true});
  assert.deepEqual(convert({enableHttpdns:'true',other:1},dns),{enableHttpdns:'true',other:1});
  const ab='mobwsa.ximalaya.com/abtest-portal/sync/synthetic';
  const plan={name:'useNewSplashV3',action:{payload:{'ad&useNewSplashV3':'true',keep:'true'}},status:1};
  const before={plans:[plan,{...structuredClone(plan),name:'anotherExperiment'},null,'synthetic'],signature:'synthetic'};
  const expected=structuredClone(before);expected.plans[0].action.payload['ad&useNewSplashV3']='false';
  assert.deepEqual(convert(before,ab),expected);
  for (const item of [{name:'useNewSplashV3'}, {name:'useNewSplashV3',action:{payload:[]}}, {name:'useNewSplashV3',action:{payload:{'ad&useNewSplashV3':true}}}]) assert.deepEqual(convert({plans:[item]},ab),{plans:[item]});
  const pop='mobile.ximalaya.com/firework-portal/v12/sync';
  const input={ret:0,signature:'synthetic',plans:[{id:'ad',type:20},{id:'cash',type:1,name:'synthetic drama promotion',fireworks:[{contentType:1,resource:{type:1,url:'https://example.invalid/promo.jpg'}}]},{id:'form',type:1,name:'儿童信息填写',fireworks:[{contentType:19}]},{id:'ordinary',type:1,name:'ordinary'},null],locations:[{planIds:['ad','form','cash','ordinary','unknown'],keep:1},{other:1},null]};
  const want=structuredClone(input);want.plans=[input.plans[2],input.plans[3],null];want.locations[0].planIds=['form','ordinary','unknown'];
  assert.deepEqual(convert(input,pop),want);
  assert.deepEqual(convert({...input,ret:1},pop),{...input,ret:1});
  assert.deepEqual(convert({ret:0,plans:[],locations:{keep:true}},pop),{ret:0,plans:[],locations:{keep:true}});
  for (const endpoint of [dns,ab,pop]) for(const value of [null,[],42,'synthetic',{}, {plans:'synthetic'}]) assert.deepEqual(convert(value,endpoint),value);
});

module.exports = { rules, matches, transformWithJq, getJqExpression, endpointRule };
