"""Render exported schema as a self-contained interactive HTML/SVG and Mermaid source."""
import json, html, re
from pathlib import Path
root=Path('docs/architecture'); data=json.loads((root/'schema-2026-10-22.json').read_text())
tables={}
for c in data['columns']:tables.setdefault(c['table_name'],[]).append(c)
groups=[('계정·고객사', '#7350bb',['tenants','users','user_accounts','partner_memberships','customers','customer_memberships','customer_invitations','customer_invite_challenges','customer_password_reset_tokens','phone_otps']),('챗봇·지식','#236a80',['bots','doc_folders','documents','qa_folders','qa_pairs','web_sources','web_previews','unanswered_reviews']),('상담·접수','#296b53',['chat_sessions','support_handoffs','chat_messages','customer_message_requests','customer_requests','request_notes']),('운영·연동','#a66724',['monthly_chat_sessions','chat_logs','operation_jobs','proactive_evaluations','slack_integrations','telegram_integrations','api_rate_limits','access_audit_logs']),('공유 데모','#a54679',['customer_demos','demo_turns','demo_requests'])]
classified={name for _,_,names in groups for name in names}
remaining=sorted(set(tables)-classified)
if remaining:groups.append(('기타 테이블','#526477',remaining))
rels={}
for r in data['relations']:rels.setdefault((r['source_table'],r['constraint_name']),[]).append(r)
mer=['erDiagram']
for name,cols in tables.items():
 mer.append('    '+name+' {')
 for c in cols:
  keys=[]
  if c['primary_key']:keys.append('PK')
  if any(r['source_table']==name and r['source_column']==c['column_name'] for r in data['relations']):keys.append('FK')
  kind=re.sub(r'[^a-zA-Z0-9_]','_',c['udt_name'])
  mer.append('        '+kind+' '+c['column_name']+(' '+', '.join(keys) if keys else ''))
 mer.append('    }')
for (source,_),rs in rels.items():
 cols={r['source_column'] for r in rs}; unique=any(u['table_name']==source and set(u['columns'])==cols for u in data['uniqueKeys'])
 nullable=any(c['is_nullable']=='YES' for c in tables[source] if c['column_name'] in cols)
 mer.append(f'    {rs[0]["target_table"]} '+('o|' if nullable else '||')+'--'+('o|' if unique else 'o{')+f' {source} : "'+', '.join(sorted(cols))+'"')
(root/'chatbot-erd.mmd').write_text('\n'.join(mer)+'\n')
positions={}; entities=[]; edges=[]; width=len(groups)*445+15; max_y=0
for gi,(label,color,names) in enumerate(groups):
 x=gi*445+20; y=66
 entities.append(f'<text x="{x}" y="34" font-size="20" font-weight="700" fill="{color}">{label}</text>')
 for name in names:
  if name not in tables:continue
  cols=tables[name]; fk={r['source_column'] for r in data['relations'] if r['source_table']==name}
  shown=[c for c in cols if c['primary_key'] or c['column_name'] in fk or c['column_name'] in ['name','status','type','expires_at','revoked_at']][:9]
  height=50+len(shown)*22
  positions[name]=(x,y,390,height)
  parts=[f'<g class="entity" data-table="{name}" tabindex="0" role="button" aria-label="{name} 상세"><rect x="{x}" y="{y}" width="390" height="{height}" rx="8" fill="white" stroke="{color}" stroke-width="1.5"/><rect x="{x}" y="{y}" width="390" height="34" rx="8" fill="{color}"/><text x="{x+14}" y="{y+23}" fill="white" font-size="15" font-weight="600">{name}</text>']
  for ci,c in enumerate(shown):
   key=('PK ' if c['primary_key'] else '')+('FK ' if c['column_name'] in fk else '')
   parts.append(f'<text x="{x+14}" y="{y+55+ci*22}" font-size="13" fill="#243449">{html.escape(key+c["column_name"])}</text><text x="{x+370}" y="{y+55+ci*22}" text-anchor="end" font-size="11" fill="#788798">{html.escape(c["udt_name"])}</text>')
  parts.append('</g>');entities.append(''.join(parts)); y+=height+30
 max_y=max(max_y,y)
for (source,constraint),rs in rels.items():
 target=rs[0]['target_table']; a=positions[source];b=positions[target]
 if a[0]==b[0]:
  x1=a[0]+390; x2=b[0]+390; y1=a[1]+17;y2=b[1]+17;mid=x1+22
  path=f'M {x1} {y1} C {mid+30} {y1}, {mid+30} {y2}, {x2} {y2}'
 else:
  forward=a[0]<b[0];x1=a[0]+(390 if forward else 0);x2=b[0]+(0 if forward else 390);y1=a[1]+17;y2=b[1]+17;mid=(x1+x2)/2
  path=f'M {x1} {y1} C {mid} {y1}, {mid} {y2}, {x2} {y2}'
 label=source+'.'+','.join(r['source_column'] for r in rs)+' → '+target
 edges.append(f'<path class="relation" data-source="{source}" data-target="{target}" d="{path}" fill="none" stroke="#7d8da2" stroke-width="1.5" marker-end="url(#arrow)"><title>{html.escape(label)}</title></path>')
svg=f'<svg xmlns="http://www.w3.org/2000/svg" id="erd" width="{width}" height="{max_y}" viewBox="0 0 {width} {max_y}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7d8da2"/></marker></defs>'+''.join(edges)+''.join(entities)+'</svg>'
(root/'chatbot-erd.svg').write_text(svg)
page='''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chatbot SDK ERD</title><style>*{box-sizing:border-box}body{margin:0;font:14px system-ui,sans-serif;background:#f3f6fa;color:#26364a}header{padding:24px 28px;background:white;border-bottom:1px solid #dce3ed}h1{margin:0 0 10px;font-size:28px}p{line-height:1.8;color:#586b80;margin:8px 0}.tools{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}button,select{padding:9px 13px;border:1px solid #c8d4e3;border-radius:6px;background:white;color:#324d72;cursor:pointer}.layout{display:grid;grid-template-columns:minmax(0,1fr) 350px}.canvas{height:78vh;overflow:auto;padding:12px}.relation{opacity:.13}.entity{cursor:pointer;outline:none}.entity:focus rect,.entity.selected rect{stroke:#e79f12;stroke-width:3}.relation.active{opacity:1;stroke:#c77713;stroke-width:2.5}aside{padding:22px;background:white;border-left:1px solid #dce3ed;height:78vh;overflow:auto}h2{font-size:19px;margin:0 0 14px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:8px 4px;text-align:left;border-bottom:1px solid #e5eaf1;overflow-wrap:anywhere}a{color:#6042a7}.stats{display:flex;gap:20px;font-weight:600;color:#3e5678}@media(max-width:900px){.layout{grid-template-columns:1fr}aside{height:auto;max-height:400px;border-top:1px solid #ddd}.canvas{height:65vh}}@media print{.canvas{height:auto;overflow:visible}aside,.tools{display:none}.layout{display:block}}</style><header><h1>Chatbot SDK · ERD</h1><div class="stats"><span>TABLES개 테이블</span><span>RELATIONS개 FK 관계</span><span>2026-10-22</span></div><p>검증 DB의 실제 스키마 기준. 고객사 권한·공유 데모의 개발 중 이관을 포함하며 운영 DB에는 아직 적용되지 않았습니다.<br>테이블을 선택하면 연결선과 전체 컬럼·관계가 표시됩니다. 고객 데이터와 키 값은 포함하지 않습니다.</p><div class="tools"><button id="out">축소 −</button><button id="in">확대 +</button><button id="reset">100%</button><select id="table"><option value="">테이블 선택</option></select><a href="chatbot-erd.mmd">Mermaid 원본</a><a href="chatbot-erd.svg">SVG</a><a href="schema-2026-10-22.json">스키마 JSON</a></div></header><div class="layout"><div class="canvas">SVG</div><aside id="info"><h2>테이블을 선택하세요</h2><p>보라: 계정·고객사<br>청록: 챗봇·지식<br>초록: 상담·접수<br>갈색: 운영·연동<br>분홍: 공유 데모</p><p>그림에는 PK/FK와 주요 상태 필드를 표시합니다. 나머지 컬럼은 테이블 선택 시 확인할 수 있습니다. FK가 선언되지 않은 논리 관계는 실선으로 추정하지 않았습니다.</p></aside></div><script type="application/json" id="schema">DATA</script><script>const schema=JSON.parse(document.querySelector('#schema').textContent),svg=document.querySelector('#erd'),select=document.querySelector('#table'),info=document.querySelector('#info');let zoom=1;const w=Number(svg.getAttribute('width')),h=Number(svg.getAttribute('height'));function size(v){zoom=Math.max(.35,Math.min(1.8,v));svg.style.width=w*zoom+'px';svg.style.height=h*zoom+'px';}document.querySelector('#in').onclick=()=>size(zoom+.15);document.querySelector('#out').onclick=()=>size(zoom-.15);document.querySelector('#reset').onclick=()=>size(1);const names=[...new Set(schema.columns.map(c=>c.table_name))];for(const name of names){const option=document.createElement('option');option.value=name;option.textContent=name;select.append(option);}function show(name){document.querySelectorAll('.entity').forEach(el=>el.classList.toggle('selected',el.dataset.table===name));document.querySelectorAll('.relation').forEach(el=>el.classList.toggle('active',el.dataset.source===name||el.dataset.target===name));info.replaceChildren();const heading=document.createElement('h2');heading.textContent=name;info.append(heading);const table=document.createElement('table');for(const col of schema.columns.filter(c=>c.table_name===name)){const tr=document.createElement('tr');for(const value of [col.column_name,col.udt_name,(col.primary_key?'PK ':'')+(col.is_nullable==='YES'?'NULL':'NOT NULL')]){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);}info.append(table);const title=document.createElement('h3');title.textContent='관련 FK';info.append(title);for(const rel of schema.relations.filter(r=>r.source_table===name||r.target_table===name)){const p=document.createElement('p');p.textContent=rel.source_table+'.'+rel.source_column+' → '+rel.target_table+'.'+rel.target_column;info.append(p);}select.value=name;}svg.addEventListener('click',e=>{const card=e.target.closest('.entity');if(card)show(card.dataset.table)});svg.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){const card=e.target.closest('.entity');if(card){e.preventDefault();show(card.dataset.table)}}});select.onchange=()=>{if(select.value){show(select.value);document.querySelector('[data-table="'+select.value+'"]').scrollIntoView({block:'center',inline:'center',behavior:'smooth'});}};</script></html>'''
page=page.replace('TABLES',str(len(tables))).replace('RELATIONS',str(len(rels))).replace('<div class="canvas">SVG</div>','<div class="canvas">'+svg+'</div>').replace('DATA',json.dumps(data,ensure_ascii=False).replace('</','<\\/'))
(root/'chatbot-erd.html').write_text(page)
print(f'{len(tables)} tables, {len(rels)} FK constraints; HTML/SVG/Mermaid rendered')
