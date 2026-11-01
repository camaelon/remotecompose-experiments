#!/usr/bin/env python3
# Hand judgements (subjective) -> labels.json, selection.json. Inputs: raw-selection.json (buildKit output).
import json,glob,os,statistics as st,sys
S=os.path.dirname(os.path.abspath(__file__))
R='/Users/nico/Documents/GitHub/remotecompose-experiments/examples/'
raw=json.load(open(S+'/raw-selection.json'))
# n: (structure, secondary, model rating, right-structure verdict, right example ids, missed good examples, note)
J={
1:('glance-card',None,'partial','partial',['TIM-11','TIM-08'],[],'TIM-08 has the text column but no drawing; only the top block of TIM-11 is the skeleton (GEN-01 is exactly that block).'),
2:('data-rows',None,'bad','no',[],['CMP-15','CMP-05'],'Countdown text column for a 4-row list; MAP-01 picked on the city names.'),
3:('hero-chart',None,'good','yes',['TIM-13','TIM-12'],[],''),
4:('glance-card',None,'good','yes',['TIM-08'],[],''),
5:('hero-chart',None,'bad','yes',['TIM-12'],[],'Fallback TIM-12 was filtered out by the widget rule, so models[0]=TIM-08 although TIM-12 is the first example returned.'),
6:('focal-actions',None,'good','yes',['TIM-14'],[],''),
7:(None,None,'good','yes',['TIM-02'],[],'A face is a drawing, not a layout skeleton.'),
8:(None,None,'bad','no',[],['TIM-10','STR-01'],'No cell strip anywhere in the returned set; the month grids (canvas-only) are nearest. TIM-10 was returned for prompt 9 but not here.'),
9:('data-rows',None,'bad','no',[],['CMP-07','CMP-15'],'Month calendar and date card picked on "day, week, month"; asks for four labelled bars.'),
10:('glance-card',None,'partial','partial',['TIM-08'],['STR-10'],'TIM-12 was picked on "season/days" words but is a phone sun screen.'),
11:('hero-chart',None,'bad','no',[],['TIM-13'],'LAY-14 is a strip of one weather column at 4 heights, 41.9 KB, not inlined; no chart. LineChart component was returned.'),
12:('meter-breakdown',None,'bad','yes',['STR-10'],[],'STR-10 is ring + text, no bars, but the right skeleton. Model: TIM-12 fallback filtered, models[0].'),
13:('data-rows',None,'bad','no',[],['CMP-15','EXP-06'],'HST-03 is one battery; MAP-05 is a capability pick for map.region: "charging state" hits its synonym "states".'),
14:('data-rows',None,'bad','no',[],['CMP-15'],'HST-02 is one sparkline, EXP-10 matched "percent, down".'),
15:('focal-actions',None,'bad','partial',['ANM-08'],['INT-08','TIM-14'],'CMP-05 contact list as model for a player. Walkthrough component returned on "previous/next".'),
16:('panel-stack',None,'good','yes',['CMP-12'],['CMP-14'],'Cards of rows; the switches are in CMP-14.'),
17:('journey-card',None,'bad','no',[],[],'No curated example has this; MAP-03 picked on delivery/tracker. Steps component was returned, and it is the real answer.'),
18:('hero-chart',None,'good','yes',['TIM-12'],[],'Rated from skeleton (header value, chart, footer); domain is unrelated. GEN-18 also has a ring.'),
19:('journey-card',None,'bad','partial',['MAP-03','HST-01'],[],'CMP-15 picked on departure/arrival: a row list for one flight.'),
20:('control-rows',None,'partial','partial',['CMP-05'],[],'Rows in a card, but the per-day cell matrix is unaddressed; STR-03 picked on "tracker".'),
21:('meter-breakdown',None,'bad','no',[],['CMP-09','STR-10'],'Only TIM-08 returned; model via models[0]. DonutChart, Legend, BigNumber components returned.'),
22:('glance-card',None,'partial','yes',['EXP-07'],[],'EXP-07 has the skeleton but is canvas-only so cannot be the model; TIM-08 lacks the scale.'),
23:('meter-breakdown',None,'partial','partial',['TIM-14'],['STR-10'],'TIM-14 has a ring but no breakdown. A11Y-04 picked on "target, fat" (touch-target demo; "fat" = fat finger).'),
24:('data-rows',None,'good','yes',['CMP-15'],[],''),
25:('data-rows',None,'bad','partial',['EXP-04'],['CMP-15','CMP-05'],'Dashboard word forces CMP-08 (gauge gallery); GEN-25 is 6 service rows.'),
26:('panel-stack',None,'good','yes',['CMP-12'],['CMP-14'],''),
27:('form-result',None,'partial','partial',['CMP-12'],[],'Rows in a card; no field display, checkbox + submit. No curated login exists (no text entry in the format).'),
28:('control-rows',None,'partial','partial',['INT-04','CMP-12'],['CMP-03'],'CMP-03 (labelled sliders) is closer but not chosen.'),
29:('form-result',None,'bad','no',[],['CMP-12'],'Model matched one word, "people", in the CMP-05 contacts keywords. CMP-12 (Stepper, rows) would have been the fallback.'),
30:('form-result',None,'partial','partial',['CMP-12'],['CMP-03'],''),
31:('control-rows',None,'good','yes',['CMP-05'],[],'Swap the trailing slot for a Checkbox.'),
32:('form-result',None,'bad','partial',['CMP-12'],['EXP-15'],'EXP-15 is exactly this but excluded from subject picks by expect_findings glyph_icon; Rating and TextChoice components returned.'),
33:(None,None,'bad','yes',['INT-07'],['CMP-06'],'CMP-12 is the fallback because the prompt says "control", though CMP-06/INT-07 is the exact structure; neither is in LAYOUT_MODELS.'),
34:('focal-actions',None,'good','yes',['TIM-14'],[],'No lap list, otherwise exact.'),
35:('param-explorer',None,'partial','partial',['CMP-12'],['CMP-03'],'Rows, no preview, no sliders.'),
36:('hero-chart',None,'bad','yes',['TIM-13','STR-11'],[],'Dashboard rule beats TIM-13, which is already the top example.'),
37:('hero-chart',None,'bad','yes',['TIM-13'],[],'Same. RankedList, BigNumber, BarChart components returned, which is GEN-37.'),
38:('data-rows',None,'bad','no',[],['CMP-07'],'"overview" forces CMP-08; it asks for category rows.'),
39:('meter-breakdown',None,'bad','no',[],['STR-10','CMP-08'],'Model via models[0]. Gauge returned.'),
40:('panel-stack',None,'partial','partial',['CMP-08'],[],'Gauge + tile; a gallery with no landscape layout.'),
41:('hero-chart',None,'bad','yes',['TIM-13'],[],'Model via models[0], TIM-13 unreachable for a widget.'),
42:('focal-actions',None,'bad','partial',['STR-03'],['TIM-14','ANM-11'],'Tide curve as model, on "water, today".'),
43:('glance-card',None,'good','yes',['TIM-08'],['HST-07'],'HST-07 is a closer glance card.'),
44:('glance-card',None,'partial','partial',['TIM-02'],[],'Analog dial, no date or battery; GEN-44 is a digital column.'),
45:('data-rows',None,'bad','no',[],['CMP-05','CMP-15'],'Icon + title + subtitle rows, given a countdown.'),
46:('glance-card',None,'partial','partial',['LAY-14'],['LAY-09'],'Right behaviour, but a demo strip of 4 copies, too long to inline.'),
47:('panel-stack',None,'bad','no',[],[],'CMP-08 gauge gallery for a black-and-white agenda; no curated equivalent exists.'),
48:('journey-card',None,'bad','no',[],[],'Countdown only. LabelValue, QrPlaceholder components returned.'),
49:('panel-stack',None,'partial','partial',['CMP-05'],['CMP-12'],'CMP-12 has the Stepper in a Card.'),
50:('step-explainer',None,'bad','partial',['INT-06'],['CMP-06'],'Contacts list as model; INT-06 has pager and dots, canvas-only. Pager returned.'),
51:('map-overlay',None,'bad','yes',['MAP-01'],[],'MAP-* are not candidates for the model, so a tide screen, on "day, now".'),
52:('map-overlay',None,'bad','yes',['MAP-04','MAP-02'],[],'Same; TIM-12 fallback.'),
53:('map-overlay','journey-card','bad','yes',['MAP-03'],[],'Same; CMP-05 fallback.'),
54:('map-overlay','journey-card','bad','yes',['MAP-03'],[],'Same; CMP-15 on departure/arrival.'),
55:('map-overlay',None,'bad','yes',['MAP-05'],[],'"overview" forces CMP-08.'),
56:('map-overlay','param-explorer','bad','yes',['MAP-01'],['CMP-03'],'TIM-13 on "time, hour, fall". Not covered: slider.'),
57:('step-explainer',None,'bad','no',[],[],'TIM-14 because "work" prefix-matches "works" in "how ... works". Walkthrough returned.'),
58:('param-explorer',None,'bad','no',[],['CMP-03'],'TIM-11 on moon words: a calendar with no slider or orbit. Walkthrough returned, though a slider is what is asked.'),
59:('param-explorer',None,'bad','partial',['TIM-13'],['CMP-03'],'TIM-13 is a capability pick for time.date, it just happens to hold a chart. Rating component returned, presumably on the word "rate" (not traced).'),
60:('step-explainer',None,'bad','no',[],['CMP-06'],'CMP-12 because "step" prefix-matches Stepper in its text. Walkthrough returned.'),
61:('step-explainer',None,'bad','no',[],[],'TIM-14 on "works". Walkthrough returned.'),
62:('param-explorer',None,'partial','partial',['TIM-12'],['CMP-03'],'Sun drawing and readouts, no slider.'),
63:('step-explainer',None,'bad','no',[],[],'TIM-12 fallback; TIM-04 (pulsing heart) a capability pick. Walkthrough NOT returned, although step mode is asked. Tabs returned instead, on "mode" (its synonyms list "modes").'),
64:('step-explainer',None,'bad','partial',['INT-08'],[],'CMP-12 on "step"; INT-08 gives the transport row. Walkthrough returned.'),
65:('step-explainer',None,'bad','no',[],[],'LAY-14 because "short" appears in the prompt ("a short explanation") and in its text. Walkthrough returned.'),
66:('param-explorer',None,'bad','no',[],['CMP-03'],'MAP-03 on "circle, time" (its keyword "great circle"). DRW-01 on "circle".'),
}
assert len(J)==66
labels={};sel={};pr=[]
for n,(s,sec,mr,ev,right,miss,note) in J.items():
    r=raw[str(n)]
    labels[n]={'prompt':r['prompt'],'structure':s or 'none'}
    if sec: labels[n]['secondary']=sec
    labels[n]['generated_doc_exists']=n<=57
    sel[n]={'prompt':r['prompt'],'structure':s or 'none',
      'layout_model':{'id':r['model'],'rating':mr,'route':r['dbg']['route'],'fallback':r['dbg']['fallback'],'fallback_in_pool':r['dbg']['fallback_in_pool'],'text_hits':(r['dbg']['top'][0]['hits'] if r['dbg']['top'] else [])},
      'examples':[{'id':e['id'],'about':e.get('about',''),'contributes':e.get('contributes',[])} for e in r['examples']],
      'components':r['components'],
      'right_structure':ev,'right_examples':right,'missed_good_examples':miss,'note':note}
json.dump(labels,open(S+'/labels.json','w'),indent=1,ensure_ascii=False)
from collections import Counter
C=Counter(v['structure'] for v in labels.values())
print(C.most_common())
ordr=[k for k,_ in C.most_common() if k!='none']
print('top5',sum(C[k] for k in ordr[:5]),'top8',sum(C[k] for k in ordr[:8]),'all',sum(C[k] for k in ordr))
m=Counter(v['layout_model']['rating'] for v in sel.values());e=Counter(v['right_structure'] for v in sel.values())
print(m,e)
print('route',Counter(v['layout_model']['route'] for v in sel.values()))
print('route x rating',sorted(Counter((v['layout_model']['route'],v['layout_model']['rating']) for v in sel.values()).items()))
print('model counts',Counter(v['layout_model']['id'] for v in sel.values()).most_common())
print('model x rating',sorted(Counter((v['layout_model']['id'],v['layout_model']['rating']) for v in sel.values()).items()))
both=[n for n,v in sel.items() if v['layout_model']['rating']=='bad' and v['right_structure']=='no']
print('bad&no',both)
print('bad model & yes ex',[n for n,v in sel.items() if v['layout_model']['rating']=='bad' and v['right_structure']=='yes'])
print('missed',[n for n,v in sel.items() if v['missed_good_examples']])
# by structure
idx={int(os.path.basename(d)[:2]):d for d in glob.glob(R+'generated/[0-9]*')}
for k,_ in C.most_common():
    ns=[n for n in J if labels[n]['structure']==k]
    b=[os.path.getsize(idx[n]+'/doc.json') for n in ns if n in idx]
    ad=sum(1 for n in ns if n in idx and any(t in open(idx[n]+'/doc.json').read() for t in('stateLayout','fitBox','ollapsible')))
    mg=sum(1 for n in ns if sel[n]['layout_model']['rating']=='good');ey=sum(1 for n in ns if sel[n]['right_structure']=='yes')
    print(k,len(ns),'prompts',ns,'genDocs',len(b),'medianKB',round(st.median(b)/1000,1) if b else None,'adaptive',ad,'modelgood',mg,'exyes',ey)
meta={'snapshot':{'catalog_mjs_sha256':'9a6a40470eb6d7c1088fea08e71ce07004e61862e3d5904146b4c4949e3b2548','catalog_built_at':'2026-11-01T17:10:34.349Z','examples':146,'max_examples':4},
 'caveat':'ratings are the analyst\'s judgement from document skeletons and renders; prompts 58-66 have no generated document, their labels come from the prompt text.',
 'totals':{'layout_model':dict(m),'right_structure':dict(e),'route':dict(Counter(v['layout_model']['route'] for v in sel.values()))},'prompts':sel}
json.dump(meta,open(S+'/selection.json','w'),indent=1,ensure_ascii=False)
