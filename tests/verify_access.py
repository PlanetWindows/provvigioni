"""Live isolation checks. Pass a private credentials JSON as the sole argument.

Uses temporary practices and a temporary agent, then removes their access/data.
Never writes or logs user passwords. The JSON has an accounts array containing
username, password, name and role. Requires Python's standard library only.
"""
import json
import sys
import time
import uuid
import http.client
import ssl
import urllib.parse
import urllib.request
import base64

ROOT = 'https://vbpinzygwexuvwomnmbt.supabase.co'
KEY = 'sb_publishable_1WuHCWsnDwZ6AqNBBBa5gA_Djh9OV_N'
host = urllib.parse.urlparse(ROOT).hostname
proxy_url = urllib.request.getproxies().get('https')
if proxy_url:
    proxy = urllib.parse.urlparse(proxy_url)
    HTTP = http.client.HTTPSConnection(proxy.hostname, proxy.port or 80, timeout=30, context=ssl.create_default_context())
    tunnel_headers = {}
    if proxy.username:
        token = (urllib.parse.unquote(proxy.username) + ':' + urllib.parse.unquote(proxy.password or '')).encode()
        tunnel_headers['Proxy-Authorization'] = 'Basic ' + base64.b64encode(token).decode()
    HTTP.set_tunnel(host, 443, headers=tunnel_headers)
else:
    HTTP = http.client.HTTPSConnection(host, timeout=30, context=ssl.create_default_context())

def call(path, method='GET', body=None, session=None):
    headers = {'apikey': KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    if session:
        headers['Authorization'] = 'Bearer ' + session['access_token']
    HTTP.request(method, path, body=None if body is None else json.dumps(body), headers=headers)
    response = HTTP.getresponse()
    content = response.read()
    return response.status, json.loads(content) if content else None

def ok(result):
    status, value = result
    assert 200 <= status < 300, (status, value)
    return value

def login(username, password):
    return ok(call('/auth/v1/token?grant_type=password', 'POST',
        {'email': username + '@accounts.provvigioni.planetwindows.it', 'password': password}))

def query(table, extra='', session=None):
    return call('/rest/v1/' + table + '?select=*' + extra, session=session)

def practice(agent, suffix):
    uid = str(uuid.uuid4())
    payload = {'_uid': uid, 'id': 'QA-' + suffix, 'client': 'Verifica temporanea',
        'agent': agent['display_name'], 'option': 'A', 'status': 'Chiusa',
        'close': '8500', 'services': '1800', 'discount': '10',
        'notes': 'Verifica accessi: dati temporanei', 'created': int(time.time()*1000),
        'updated': int(time.time()*1000)}
    return {'uid': uid, 'code': payload['id'], 'agent_id': agent['id'], 'payload': payload}

credentials = json.load(open(sys.argv[1]))['accounts']
suffix = uuid.uuid4().hex[:12]
sessions = {}
accounts = {}
test_uids = []
qa_id = None
office = None
checks = []
try:
    for cred in credentials:
        session = login(cred['username'], cred['password'])
        sessions[cred['username']] = session
        visible = ok(query('provvigioni_accounts', session=session))
        own = next(a for a in visible if a['user_id'] == session['user']['id'])
        assert own['role'] == cred['role'] and own['display_name'] == cred['name']
        accounts[cred['username']] = own
        if cred['role'] == 'office':
            office = session
            assert len([a for a in visible if a['active']]) == 4
        else:
            assert len(visible) == 1
    checks.append('All four credentials and roles')
    agents = [c['username'] for c in credentials if c['role'] == 'agent']
    for i, name in enumerate(agents):
        p = practice(accounts[name], suffix + '-' + str(i))
        row = ok(call('/rest/v1/provvigioni_practices', 'POST', p, sessions[name]))[0]
        test_uids.append(row['uid'])
    ids = '&uid=in.(' + ','.join(test_uids) + ')'
    assert len(ok(query('provvigioni_practices', ids, office))) == 3
    for i, name in enumerate(agents):
        rows = ok(query('provvigioni_practices', ids, sessions[name]))
        assert len(rows) == 1 and rows[0]['agent_id'] == accounts[name]['id']
        p = rows[0]
        p['payload']['agent'] = 'Altra identità'
        p['payload']['close'] = '8600'
        own_update = ok(call('/rest/v1/provvigioni_practices?uid=eq.' + p['uid'], 'PATCH',
            {'payload': p['payload']}, sessions[name]))
        assert own_update[0]['payload']['agent'] == accounts[name]['display_name']
        assert own_update[0]['version'] == p['version'] + 1
        denied = ok(call('/rest/v1/provvigioni_practices?uid=eq.' + p['uid'] + '&version=eq.' + str(p['version']),
            'PATCH', {'payload': p['payload']}, sessions[name]))
        assert denied == []
    checks.append('Each agent reads/edits only own practices; conflicting saves blocked')
    first, other = agents[:2]
    denied = ok(call('/rest/v1/provvigioni_practices?uid=eq.' + test_uids[1], 'PATCH',
        {'code': 'FORGED'}, sessions[first]))
    assert denied == []
    forged = practice(accounts[other], suffix + '-forged')
    assert call('/rest/v1/provvigioni_practices', 'POST', forged, sessions[first])[0] in (400,403)
    reassignment = ok(call('/rest/v1/provvigioni_practices?uid=eq.' + test_uids[0], 'PATCH',
        {'agent_id': accounts[other]['id']}, office))
    assert reassignment[0]['agent_id'] == accounts[other]['id']
    assert ok(query('provvigioni_practices', '&uid=eq.' + test_uids[0], sessions[first])) == []
    checks.append('Guessed IDs and forged ownership blocked; Ufficio can reassign')
    assert query('provvigioni_accounts')[0] in (401,403)
    assert query('provvigioni_practices')[0] in (401,403)
    assert query('provvigioni_rules')[0] in (401,403)
    assert call('/rest/v1/provvigioni_accounts?id=eq.' + accounts[first]['id'], 'PATCH',
        {'role': 'office'}, sessions[first])[0] == 403
    settings = ok(query('provvigioni_rules', session=office))[0]
    assert ok(call('/rest/v1/provvigioni_rules?id=eq.1', 'PATCH',
        {'document': settings['document']}, sessions[first])) == []
    written = ok(call('/rest/v1/provvigioni_rules?id=eq.1&version=eq.' + str(settings['version']),
        'PATCH', {'document': settings['document']}, office))
    assert written[0]['document'] == settings['document']
    checks.append('Anonymous access, role escalation and agent rule changes blocked')
    assert call('/functions/v1/provvigioni-admin', 'POST', {'action': 'create'})[0] == 401
    assert call('/functions/v1/provvigioni-admin', 'POST', {'action': 'create'}, sessions[first])[0] == 403
    qa = ok(call('/functions/v1/provvigioni-admin', 'POST', {
        'action':'create', 'name':'Verifica temporanea', 'username':'qa.' + suffix}, office))
    qa_id = qa['account']['id']
    qa_session = login(qa['account']['username'], qa['password'])
    assert len(ok(query('provvigioni_accounts', session=qa_session))) == 1
    assert ok(query('profiles', session=qa_session)) == []
    assert ok(query('poses', session=qa_session)) == []
    reset = ok(call('/functions/v1/provvigioni-admin', 'POST', {'action':'reset','account_id':qa_id}, office))
    assert ok(query('provvigioni_rules', session=qa_session)) == []
    refresh_status, refreshed = call('/auth/v1/token?grant_type=refresh_token', 'POST', {'refresh_token':qa_session['refresh_token']})
    if refresh_status == 200:
        assert ok(query('provvigioni_rules', session=refreshed)) == []
    else:
        assert refresh_status in (400,401)
    qa_new_session = login(qa['account']['username'], reset['password'])
    assert len(ok(query('provvigioni_rules', session=qa_new_session))) == 1
    p = practice(qa['account'], suffix + '-qa')
    test_uids.append(ok(call('/rest/v1/provvigioni_practices', 'POST', p, qa_new_session))[0]['uid'])
    ok(call('/functions/v1/provvigioni-admin', 'POST', {'action':'delete','account_id':qa_id}, office))
    assert ok(query('provvigioni_rules', session=qa_new_session)) == []
    assert len(ok(query('provvigioni_practices', '&uid=eq.' + p['uid'], office))) == 1
    assert call('/functions/v1/provvigioni-admin', 'POST', {
        'action':'delete','account_id':accounts['ufficio']['id']}, office)[0] == 400
    checks.append('Ufficio creates, resets and deletes access; old sessions blocked; records preserved')
    checks.append('Commission accounts have no PW Posa profile or access')
finally:
    if office:
        for uid in test_uids:
            ok(call('/rest/v1/provvigioni_practices?uid=eq.' + uid, 'DELETE', session=office))
        if qa_id:
            current = ok(query('provvigioni_accounts','&id=eq.' + qa_id,office))
            if current and current[0]['active']:
                ok(call('/functions/v1/provvigioni-admin','POST',{'action':'delete','account_id':qa_id},office))
        if qa_id:
            print('Temporary inactive account for metadata cleanup:',qa_id)
    for session in sessions.values():
        call('/auth/v1/logout?scope=local','POST',session=session)
for check in checks:
    print('PASS:',check)
