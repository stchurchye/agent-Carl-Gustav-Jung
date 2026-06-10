#!/usr/bin/env python3
"""架构报告 md → PDF(v2)。复刻初版版式:绿标题/绿头表格/灰底引言/mermaid→PNG 按序嵌入。"""
import re, os, glob
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                Image, HRFlowable, KeepTogether)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

MD = '/Users/church/claude/agent-Carl-Gustav-Jung/docs/reports/2026-06-10-agent-architecture-and-comparison.md'
OUT = '/Users/church/claude/agent-Carl-Gustav-Jung/docs/reports/2026-06-10-agent-architecture-and-comparison.pdf'
DIAG = sorted(glob.glob('/Users/church/claude/agent-Carl-Gustav-Jung/docs/reports/diagrams/fig*.png'))

pdfmetrics.registerFont(TTFont('CN', '/System/Library/Fonts/STHeiti Medium.ttc'))
pdfmetrics.registerFont(TTFont('CNL', '/System/Library/Fonts/STHeiti Light.ttc'))

GREEN = colors.HexColor('#2e7d62')
DARK = colors.HexColor('#1a3c34')
GREY = colors.HexColor('#444444')

def st(name, **kw):
    base = dict(fontName='CNL', fontSize=10.5, leading=16, textColor=GREY, spaceAfter=6)
    base.update(kw)
    return ParagraphStyle(name, **base)

S = {
  'title': st('title', fontName='CN', fontSize=22, leading=30, textColor=DARK, spaceAfter=4),
  'subtitle': st('subtitle', fontSize=11.5, textColor=colors.HexColor('#5a7d75'), spaceAfter=2),
  'date': st('date', fontSize=10, textColor=colors.HexColor('#888888'), alignment=1, spaceAfter=10),
  'h1': st('h1', fontName='CN', fontSize=17, leading=24, textColor=DARK, spaceBefore=18, spaceAfter=8),
  'h2': st('h2', fontName='CN', fontSize=13.5, leading=20, textColor=GREEN, spaceBefore=14, spaceAfter=6),
  'h3': st('h3', fontName='CN', fontSize=11.5, leading=17, textColor=GREEN, spaceBefore=10, spaceAfter=4),
  'body': st('body'),
  'quote': st('quote', fontSize=9.5, leading=15, textColor=colors.HexColor('#3d5a52'),
              backColor=colors.HexColor('#eef4f1'), borderPadding=8, leftIndent=6, rightIndent=6, spaceAfter=10),
  'li': st('li', leftIndent=14, bulletIndent=4),
  'cap': st('cap', fontSize=8.5, textColor=colors.HexColor('#999999'), alignment=1, spaceAfter=10),
  'cell': st('cell', fontSize=8.8, leading=12.5, spaceAfter=0),
  'cellh': st('cellh', fontName='CN', fontSize=8.8, leading=12.5, textColor=DARK, spaceAfter=0),
}

def inline(t):
    t = t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    t = re.sub(r'\*\*(.+?)\*\*', r'<b><font face="CN">\1</font></b>', t)
    t = re.sub(r'`([^`]+)`', r'<font face="CN" size="9" color="#2e7d62">\1</font>', t)
    t = re.sub(r'\[\[(.+?)\]\]', r'<i>\1</i>', t)
    return t

def make_table(rows):
    data, widths = [], None
    for i, r in enumerate(rows):
        cells = [c.strip() for c in r.strip().strip('|').split('|')]
        if i == 1 and all(re.fullmatch(r':?-{2,}:?', c) for c in cells):
            continue
        style = S['cellh'] if i == 0 else S['cell']
        data.append([Paragraph(inline(c), style) for c in cells])
    if not data: return None
    n = len(data[0])
    total = 170*mm
    widths = [total/n]*n
    if n >= 3:
        widths = [total*0.26] + [total*0.74/(n-1)]*(n-1) if n == 3 else [total/n]*n
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#e3efe9')),
        ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#c5d8d0')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 4), ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5), ('RIGHTPADDING', (0,0), (-1,-1), 5),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f7faf8')]),
    ]))
    return t

src = open(MD).read()
fm = re.match(r'---\n(.*?)\n---\n', src, re.S)
meta = dict(re.findall(r'^(\w+): (.+)$', fm.group(1), re.M)) if fm else {}
body = src[fm.end():] if fm else src

story = [Spacer(1, 8*mm),
         Paragraph(inline(meta.get('title','')), S['title']),
         Paragraph(inline(meta.get('subtitle','')), S['subtitle']),
         Paragraph(inline(meta.get('date','')), S['date'])]

lines = body.split('\n')
i, fig = 0, 0
while i < len(lines):
    ln = lines[i]
    if ln.startswith('```mermaid'):
        while i < len(lines) and lines[i].strip() != '```': i += 1
        if fig < len(DIAG):
            img = Image(DIAG[fig]); ar = img.imageWidth/img.imageHeight
            w = min(165*mm, img.imageWidth*0.55); h = w/ar
            if h > 150*mm: h = 150*mm; w = h*ar
            img.drawWidth, img.drawHeight = w, h
            story.append(KeepTogether([img, Paragraph(f'图 {fig+1}', S['cap'])]))
            fig += 1
    elif ln.startswith('> '):
        buf = []
        while i < len(lines) and (lines[i].startswith('>') ):
            buf.append(lines[i].lstrip('> ').rstrip()); i += 1
        i -= 1
        story.append(Paragraph(inline(' <br/> '.join(b for b in buf if b)), S['quote']))
    elif ln.startswith('|'):
        buf = []
        while i < len(lines) and lines[i].startswith('|'):
            buf.append(lines[i]); i += 1
        i -= 1
        t = make_table(buf)
        if t: story.append(t); story.append(Spacer(1, 4*mm))
    elif ln.startswith('# '):
        story.append(Paragraph(inline(ln[2:]), S['h1']))
        story.append(HRFlowable(width='100%', thickness=1.2, color=GREEN, spaceAfter=6))
    elif ln.startswith('## '):
        story.append(Paragraph(inline(ln[3:]), S['h2']))
    elif ln.startswith('### '):
        story.append(Paragraph(inline(ln[4:]), S['h3']))
    elif re.match(r'^\s*[-*] ', ln) or re.match(r'^\s*\d+\. ', ln):
        m = re.match(r'^(\s*)([-*]|\d+\.) (.*)$', ln)
        indent = len(m.group(1)); bullet = '•' if m.group(2) in '-*' else m.group(2)
        story.append(Paragraph(f'{bullet} {inline(m.group(3))}',
                     st(f'li{i}', leftIndent=14+indent*6, spaceAfter=3)))
    elif ln.strip() == '---':
        story.append(Spacer(1, 3*mm))
    elif ln.strip():
        story.append(Paragraph(inline(ln), S['body']))
    i += 1

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=20*mm, rightMargin=20*mm,
                        topMargin=18*mm, bottomMargin=18*mm, title=meta.get('title',''))
doc.build(story)
print('OK', OUT, 'figs_used=', fig)
