# Output tokens of eval runs by category, from agent transcripts: run-tokens.py name=transcript.jsonl ...
import json,sys,re
for name,p in [a.split('=') for a in sys.argv[1:]]:
    seen={}
    for l in open(p):
        try: r=json.loads(l)
        except: continue
        m=r.get('message') or {}
        if r.get('type')!='assistant': continue
        e=seen.setdefault(m.get('id'),dict(out=0,cats={}))
        e['out']=max(e['out'],(m.get('usage') or {}).get('output_tokens',0))
        for b in m.get('content') or []:
            if b.get('type')!='tool_use': continue
            i=b['input']; n=b['name']; size=len(json.dumps(i))
            blob=json.dumps(i)
            if n=='Write':
                fp=i.get('file_path','')
                cat='notes' if 'notes' in fp else ('document' if ('"root"' in i.get('content','') ) else ('edits' if '"edits"' in i.get('content','') else 'check-args'))
            elif n=='Edit':
                cat='notes' if 'notes' in i.get('file_path','') else 'edits'
            elif n=='Bash':
                c=i.get('command','')
                cat='document' if '"root"' in c else ('edits' if 'edits' in c else ('notes' if 'notes.md' in c else 'commands'))
            else: cat='commands'
            e['cats'][cat]=e['cats'].get(cat,0)+size
    tot=sum(e['out'] for e in seen.values())
    cats={}
    for e in seen.values():
        for k,v in e['cats'].items(): cats[k]=cats.get(k,0)+v
    # tokens/char from turns dominated by one write: estimate 2.9 chars/token for JSON
    rate=2.9
    est={k:round(v/rate) for k,v in cats.items()}
    think=tot-sum(est.values())
    print(name,'output',tot,{k:f"{v}t" for k,v in sorted(est.items(),key=lambda x:-x[1])},'thinking~',think, f"= {100*think//tot}%")
    # sample of turns where almost pure writing, to calibrate
