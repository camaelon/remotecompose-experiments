# Where an eval run's output tokens went, turn by turn: run-trace.py [-v] name=transcript.jsonl ...
# Phases: orient (up to the first build), first build (the turn that first writes or converts a
# document), revise (the rest). Each revising turn is tagged by what came just before it: an image
# it opened (looked), a warning or error from a tool (finding), else its own idea (self).
# Thinking text is not in transcripts, so thinking tokens are estimated: a turn's output tokens
# less its tool input at 2.9 characters per token.
import json,re,sys
RATE=2.9
def text_of(c):
    if isinstance(c,str): return c
    out=''
    for b in c or []:
        if b.get('type')=='text': out+=b.get('text','')
        elif b.get('type')=='image': out+=' [image] '
    return out
def turns(p):
    order=[];seen={};results={}
    for l in open(p):
        try: r=json.loads(l)
        except ValueError: continue
        m=r.get('message') or {}
        if r.get('type')=='assistant':
            k=m.get('id')
            if k not in seen: seen[k]=dict(out=0,tools=[]);order.append(seen[k])
            seen[k]['out']=max(seen[k]['out'],(m.get('usage') or {}).get('output_tokens',0))
            for b in m.get('content') or []:
                if b.get('type')=='tool_use': seen[k]['tools'].append(b)
        elif r.get('type')=='user' and isinstance(m.get('content'),list):
            for b in m['content']:
                if b.get('type')=='tool_result': results[b.get('tool_use_id')]=text_of(b.get('content'))
    return order,results
def is_build(b):
    i=b['input']; s=json.dumps(i)
    if b['name']=='Write': return 'notes' not in i.get('file_path','') and '"root"' in i.get('content','')
    if b['name']=='Bash': return bool(re.search(r'remotecompose (convert|check_component)|"root"',i.get('command','')))
    return False
def is_look(b):
    return b['name']=='Read' and b['input'].get('file_path','').endswith('.png')
def is_edit(b):
    i=b['input']
    if b['name']=='Edit': return 'notes' not in i.get('file_path','')
    if b['name']=='Write': return 'notes' not in i.get('file_path','')
    return b['name']=='Bash' and '"edits"' in i.get('command','')
WARN=re.compile(r'\b(warning|error|text_overflow|zero_size|clipped|drag_missed)\b',re.I)
verbose='-v' in sys.argv
for a in [x for x in sys.argv[1:] if x!='-v']:
    name,p=a.split('=',1)
    order,results=turns(p)
    ph=dict(orient=[0,0],first=[0,0],revise=[0,0]); trig=dict(looked=[0,0],finding=[0,0],self=[0,0]); built=False; last='self'
    calls=looks=converts=0; rows=[]
    for n,t in enumerate(order):
        chars=sum(len(json.dumps(b['input'])) for b in t['tools']); wrote=round(chars/RATE); think=max(0,t['out']-wrote)
        build=any(is_build(b) for b in t['tools'])
        phase='revise' if built else ('first' if build else 'orient')
        if build: built=True
        ph[phase][0]+=t['out']; ph[phase][1]+=think
        tag=''
        if phase=='revise':
            tag=last; trig[tag][0]+=t['out']; trig[tag][1]+=think
        calls+=len(t['tools']); looks+=sum(is_look(b) for b in t['tools'])
        converts+=sum(b['name']=='Bash' and 'remotecompose convert' in b['input'].get('command','') for b in t['tools'])
        rows.append((n,t['out'],think,phase,tag,','.join(b['name'] for b in t['tools'])))
        res=' '.join(results.get(b.get('id'),'') for b in t['tools'])
        if any(is_look(b) for b in t['tools']): last='looked'
        elif WARN.search(res) and not re.search('NO FAULTS FOUND',res): last='finding'
        elif t['tools']: last='self'
    tot=sum(t['out'] for t in order)
    f=lambda d:' '.join(f"{k} {v[0]/1000:.1f}K(think {v[1]/1000:.1f})" for k,v in d.items())
    print(f"{name}: {tot/1000:.1f}K turns {len(order)} calls {calls} images {looks} converts {converts}\n  phase  {f(ph)}\n  revise {f(trig)}")
    if verbose:
        for r in rows: print('   ',*r)
