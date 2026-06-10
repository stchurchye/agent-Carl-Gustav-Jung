#!/usr/bin/env python3
"""深度 agent 测试 → 厚 PDF。逐轮:用户话术 + 内部逻辑链(每步全字段)+ agent 终稿。
用法: python3 deep_test_pdf.py /tmp/deep-test-S1.json [更多.json] -o /tmp/deep-agent-test.pdf
字体用已核验存在的: STHeiti Medium.ttc(正文) + Arial Unicode.ttf(等宽/JSON)。
"""
import json, sys, os, textwrap
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Preformatted,
                                PageBreak, Table, TableStyle, HRFlowable)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

CN = '/System/Library/Fonts/STHeiti Medium.ttc'
MONO = '/Library/Fonts/Arial Unicode.ttf'
pdfmetrics.registerFont(TTFont('CN', CN, subfontIndex=0))
pdfmetrics.registerFont(TTFont('Mono', MONO))

ss = getSampleStyleSheet()
def style(name, **kw):
    base = dict(fontName='CN', fontSize=10, leading=15, wordWrap='CJK')
    base.update(kw); return ParagraphStyle(name, **base)
H1 = style('H1', fontSize=18, leading=24, spaceAfter=10, textColor=colors.HexColor('#1b5e20'))
H2 = style('H2', fontSize=14, leading=20, spaceBefore=14, spaceAfter=6, textColor=colors.HexColor('#2e7d52'))
H3 = style('H3', fontSize=11.5, leading=17, spaceBefore=10, spaceAfter=3, textColor=colors.HexColor('#c0392b'))
BODY = style('BODY')
USER = style('USER', fontSize=11, leading=17, textColor=colors.HexColor('#0b4f8a'), spaceBefore=4)
MUTED = style('MUTED', fontSize=8.5, leading=12, textColor=colors.HexColor('#888888'))
def pre(txt):
    return Preformatted(txt, ParagraphStyle('pre', fontName='Mono', fontSize=7.2, leading=9.2))

def esc(s):
    return (s or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def jtrunc(v, n=900):
    s = json.dumps(v, ensure_ascii=False, indent=1) if not isinstance(v, str) else v
    return s if len(s) <= n else s[:n] + f'\n… (截断,共 {len(s)} 字符)'

KIND_CN = {'plan':'规划','replan':'重规划','tool_call':'调用工具','tool_error':'工具失败',
           'observe':'观察(缓存命中)','critique':'复盘','reply':'回复','steer':'插话',
           'approval_request':'请求授权','approval_grant':'已授权','approval_deny':'拒绝授权',
           'user_input':'用户回答','subagent_tool_denied':'子agent工具被拒'}

def build(files, outpath):
    story = []
    # 封面 / 方法论
    story.append(Paragraph('深度 Agent 测试报告', H1))
    story.append(Paragraph('agent-Carl-Gustav-Jung · 真 DeepSeek 自主运行 · 逐轮全内部逻辑链', MUTED))
    story.append(Spacer(1, 6))
    story.append(Paragraph('方法论与诚实声明', H2))
    for t in [
        '<b>真模型自主</b>:agent 的每一步(规划/工具/复盘/回复)由真实 DeepSeek(deepseek-chat,直连 api.deepseek.com)自主产出,'
        '<b>非操作者经 relay 手写</b> → 不存在"自评污染",回复内容与内部行为均为可信证据,测评者是纯外部观察。',
        '<b>测什么</b>:① agent 编排机器逻辑(多步规划、工具选型、续跑、自我批判、记忆读写、控制面)—— 代码产出,强证据;'
        '② 心理学回复的深度/一致性 —— 真模型产出,可评。心理学对话是<b>驱动器</b>。',
        '<b>取证</b>:逐轮直查 agent_steps(全量、按 idx 序、每步全字段:kind/tool/input/output/error/tokens/耗时)+ 私聊终稿(buildFinalContent)。'
        '记忆类证据(情景记忆)在外部 MAGI 服务,本报告以 agent_steps 内的 recall 工具输出为准。',
        '<b>局限</b>:每轮=一次独立 agent_run;近轮"记得上轮"部分来自 session 历史窗口而非纯长期记忆机制;'
        'deepseek-chat 非 reasoning 模型,reply 受 maxTokens≈800 限。',
    ]:
        story.append(Paragraph(t, BODY)); story.append(Spacer(1, 3))

    grand = {'turns':0,'steps':0,'tokens':0,'cost':0.0,'secs':0}
    for fp in files:
        if not os.path.exists(fp): continue
        data = json.load(open(fp))
        story.append(PageBreak())
        story.append(Paragraph(f"场景 {data['scenario']} — {data['title']}", H1))
        story.append(Paragraph(f"model={data.get('model')} · {len(data['turns'])} 轮 · 跑于 {data.get('ranAt','')}", MUTED))
        # 场景概览表
        rows = [['轮','状态','步数','tokens','¥','秒','工具序列']]
        for tn in data['turns']:
            tools = ' → '.join(s['tool_name'] for s in (tn.get('steps') or []) if s['kind']=='tool_call' and s.get('tool_name'))
            u = tn.get('usage') or {}
            rows.append([str(tn['idx']), tn.get('status','?'), str(len(tn.get('steps') or [])),
                         str(u.get('tokens','')), f"{u.get('costCny','')}", str(u.get('elapsedSeconds','')),
                         (tools[:46]+'…') if len(tools)>46 else tools])
        tbl = Table(rows, colWidths=[10*mm,22*mm,12*mm,16*mm,14*mm,10*mm,76*mm])
        tbl.setStyle(TableStyle([('FONTNAME',(0,0),(-1,-1),'CN'),('FONTSIZE',(0,0),(-1,-1),7.5),
            ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e8f0ea')),('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#cccccc')),
            ('VALIGN',(0,0),(-1,-1),'TOP')]))
        story.append(tbl); story.append(Spacer(1, 6))

        for tn in data['turns']:
            story.append(PageBreak())
            story.append(Paragraph(f"第 {tn['idx']} 轮", H2))
            story.append(Paragraph('👤 用户:', H3))
            story.append(Paragraph(esc(tn['text']), USER))
            u = tn.get('usage') or {}
            story.append(Paragraph(f"run={tn.get('runId','')[:8]} · {tn.get('status')} · "
                                   f"{len(tn.get('steps') or [])} 步 · {u.get('tokens','?')} tok · ¥{u.get('costCny','?')} · {u.get('elapsedSeconds','?')}s", MUTED))
            grand['turns']+=1; grand['steps']+=len(tn.get('steps') or [])
            grand['tokens']+=u.get('tokens',0) or 0; grand['cost']+=float(u.get('costCny',0) or 0); grand['secs']+=u.get('elapsedSeconds',0) or 0
            if tn.get('error'):
                story.append(Paragraph('⚠ '+esc(tn['error']), H3)); continue
            story.append(Paragraph('🧠 内部逻辑链(agent_steps 全量):', H3))
            for s in (tn.get('steps') or []):
                kc = KIND_CN.get(s['kind'], s['kind'])
                head = f"#{s['idx']} [{kc}]" + (f" · {s['tool_name']}" if s.get('tool_name') else '')
                if s.get('error'): head += f"  ⚠err={s['error'][:60]}"
                meta = f"  ({s.get('tokens','')}tok {s.get('duration_ms','')}ms)"
                story.append(Paragraph(esc(head)+meta, ParagraphStyle('sh',fontName='CN',fontSize=8.5,leading=12,textColor=colors.HexColor('#444'),spaceBefore=4)))
                if s.get('input') is not None:
                    story.append(pre('input: '+jtrunc(s['input'], 600)))
                if s.get('output') is not None:
                    story.append(pre('output: '+jtrunc(s['output'], 1100)))
            story.append(Spacer(1, 4))
            story.append(Paragraph('💬 Agent 终稿回复:', H3))
            story.append(Paragraph(esc(tn.get('reply') or '(未捕获终稿)'), BODY))

    story.insert(6, Paragraph(
        f"<b>总计</b>:{grand['turns']} 轮 · {grand['steps']} 内部步 · {grand['tokens']} tokens · ¥{round(grand['cost'],4)} · {grand['secs']}s", BODY))
    SimpleDocTemplate(outpath, pagesize=A4, topMargin=16*mm, bottomMargin=16*mm,
                      leftMargin=15*mm, rightMargin=15*mm).build(story)
    print('PDF →', outpath, os.path.getsize(outpath), 'bytes')

if __name__ == '__main__':
    args = sys.argv[1:]
    out = '/tmp/deep-agent-test.pdf'
    if '-o' in args:
        i = args.index('-o'); out = args[i+1]; args = args[:i]+args[i+2:]
    build(args, out)
