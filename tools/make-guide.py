"""Genera la guida di prova per i generatori di immagini AI:
 - guida-silhouette.png  : manichino neutro, fronte / profilo (verso destra) / retro, da dare come immagine di riferimento
 - guida-mappa-parti.png : stesso layout con parti colorate e linee di riferimento (per l'allineamento e il controllo)
"""
from PIL import Image, ImageDraw, ImageFont
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'guida-di-prova')
CW, CH = 1024, 1536
BASE, TOP = 1440, 130           # linea dei piedi e cima della testa (altezza figura 1310 px ≈ 7,5 teste)
LAND = [('TESTA', 130), ('MENTO', 305), ('SPALLE', 370), ('GOMITI', 640), ('ANCHE', 790), ('GINOCCHIA', 1110), ('PIEDI', 1440)]
COL = dict(head='#ff595e', neck='#ff924c', torso='#ffca3a', pelvis='#8ac926', uarmL='#1982c4', uarmR='#4cc9f0', farmL='#6a4c93', farmR='#b5179e',
           handL='#f72585', handR='#ff7096', thighL='#2ec4b6', thighR='#3a86ff', shinL='#fb5607', shinR='#8338ec', footL='#06d6a0', footR='#ffbe0b')
FONT = None
for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'):
    if os.path.exists(f): FONT = f
font = lambda s: ImageFont.truetype(FONT, s) if FONT else ImageFont.load_default()

import math
from PIL import ImageFilter

def limb(d, a, b, ra, rb, fill):
    """Arto rastremato: due cerchi (raggi ra, rb) uniti da un trapezio."""
    ang = math.atan2(b[1]-a[1], b[0]-a[0]) + math.pi/2
    ox, oy = math.cos(ang), math.sin(ang)
    d.polygon([(a[0]+ox*ra, a[1]+oy*ra), (b[0]+ox*rb, b[1]+oy*rb), (b[0]-ox*rb, b[1]-oy*rb), (a[0]-ox*ra, a[1]-oy*ra)], fill=fill)
    for p, r in ((a, ra), (b, rb)): d.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill=fill)

def ell(d, c, rx, ry, fill): d.ellipse([c[0]-rx, c[1]-ry, c[0]+rx, c[1]+ry], fill=fill)

def front(d, cx, c):   # c: funzione colore per parte
    for s_, k in ((-1, 'L'), (1, 'R')):
        limb(d, (cx+s_*80, 800), (cx+s_*100, 1110), 56, 42, c('thigh'+k)); limb(d, (cx+s_*100, 1110), (cx+s_*106, 1385), 42, 31, c('shin'+k))
        ell(d, (cx+s_*122, 1414), 56, 27, c('foot'+k))
        limb(d, (cx+s_*152, 398), (cx+s_*250, 640), 34, 27, c('uarm'+k)); limb(d, (cx+s_*250, 640), (cx+s_*325, 860), 27, 21, c('farm'+k)); ell(d, (cx+s_*338, 915), 33, 48, c('hand'+k))
    d.polygon([(cx-146, 380), (cx-100, 366), (cx+100, 366), (cx+146, 380), (cx+138, 470), (cx+112, 650), (cx-112, 650), (cx-138, 470)], fill=c('torso'))
    d.polygon([(cx-112, 640), (cx+112, 640), (cx+130, 790), (cx+120, 835), (cx-120, 835), (cx-130, 790)], fill=c('pelvis'))
    ell(d, (cx-146, 400), 38, 38, c('uarmL')); ell(d, (cx+146, 400), 38, 38, c('uarmR'))
    limb(d, (cx, 296), (cx, 360), 34, 40, c('neck')); ell(d, (cx, 217), 72, 88, c('head'))

def side(d, cx, c):    # guarda a destra
    # lato lontano
    limb(d, (cx+30, 800), (cx+66, 1110), 56, 40, c('thighL')); limb(d, (cx+66, 1110), (cx+54, 1385), 40, 29, c('shinL'))
    d.polygon([(cx+22, 1380), (cx+62, 1380), (cx+150, 1405), (cx+186, 1425), (cx+178, 1442), (cx+16, 1442)], fill=c('footL'))
    limb(d, (cx+4, 398), (cx+26, 640), 34, 27, c('uarmL')); limb(d, (cx+26, 640), (cx+44, 860), 27, 21, c('farmL')); ell(d, (cx+50, 912), 30, 46, c('handL'))
    # corpo (petto avanti, schiena leggermente curva)
    d.polygon([(cx-70, 372), (cx+10, 362), (cx+70, 380), (cx+92, 450), (cx+78, 560), (cx+66, 650), (cx-70, 650), (cx-86, 540), (cx-84, 440)], fill=c('torso'))
    d.polygon([(cx-70, 640), (cx+66, 640), (cx+84, 730), (cx+72, 835), (cx-92, 835), (cx-98, 730)], fill=c('pelvis'))
    limb(d, (cx+2, 296), (cx+4, 360), 32, 38, c('neck')); ell(d, (cx+8, 217), 80, 88, c('head'))
    # lato vicino
    limb(d, (cx-26, 800), (cx-14, 1110), 60, 44, c('thighR')); limb(d, (cx-14, 1110), (cx-40, 1390), 44, 31, c('shinR'))
    d.polygon([(cx-72, 1384), (cx-20, 1384), (cx+70, 1408), (cx+108, 1428), (cx+100, 1444), (cx-78, 1444)], fill=c('footR'))
    limb(d, (cx-6, 400), (cx+22, 640), 38, 29, c('uarmR')); limb(d, (cx+22, 640), (cx+46, 860), 29, 22, c('farmR')); ell(d, (cx+54, 912), 32, 48, c('handR'))

def sheet(mapmode):
    bg = '#ffffff' if not mapmode else '#f4f5f7'
    im = Image.new('RGB', (CW*3, CH), bg); d = ImageDraw.Draw(im)
    grey = lambda k: '#aeb4bb'
    colr = lambda k: COL[k]
    c = colr if mapmode else grey
    for i, fn in enumerate((front, side, front)):
        fn(d, CW*i + CW//2, c)
    if mapmode:
        for i in range(1, 3): d.line([(CW*i, 0), (CW*i, CH)], fill='#c8ccd2', width=3)
        for name, y in LAND:
            for x in range(0, CW*3, 36): d.line([(x, y), (x+18, y)], fill='#7aa7e0', width=2)
            d.text((10, y-34), name, fill='#2f6fcb', font=font(26))
        for i, t in enumerate(('FRONTE', 'PROFILO  (guarda a destra)', 'RETRO')):
            d.text((CW*i + CW//2, 50), t, fill='#222', font=font(40), anchor='mm')
        d.text((CW*3-20, CH-24), 'Linea dei piedi: y=1440 · altezza figura 1310 px (≈7,5 teste) · 3 celle da 1024×1536', fill='#555', font=font(22), anchor='rm')
    return im

def smooth(im):
    """Sagoma pulita: fonde le giunture e leviga il contorno (sfocatura + soglia)."""
    g = im.convert('L').point(lambda v: 255 if v < 250 else 0).filter(ImageFilter.GaussianBlur(7)).point(lambda v: 255 if v > 128 else 0)
    out = Image.new('RGB', im.size, '#ffffff'); out.paste(Image.new('RGB', im.size, '#aeb4bb'), mask=g)
    return out

smooth(sheet(False)).save(os.path.join(OUT, 'guida-silhouette.png'))
sheet(True).save(os.path.join(OUT, 'guida-mappa-parti.png'))
print('ok')

# ======================================================================================================================
# Pose extra: arrampicata e salto (profilo verso destra). Le coordinate dei giunti servono sia per disegnare la sagoma
# sia per ricavare i modelli di posizionamento automatico dello scheletro (frazioni dell'altezza della figura).
# L = arti lontani, R = arti vicini.
# ======================================================================================================================
import json
POSES = {
  'climb': dict(
    headTop=(520, 200), neck=(512, 372), pelvis=(488, 800), shoulderR=(520, 440), shoulderL=(510, 440),
    elbowR=(690, 360), elbowL=(650, 330), wristR=(745, 215), wristL=(705, 185), handR=(752, 150), handL=(712, 120),
    hipR=(496, 830), hipL=(486, 830), kneeR=(640, 960), kneeL=(500, 1060), ankleR=(560, 1110), ankleL=(480, 1290),
    toeR=(655, 1135), toeL=(580, 1315)),
  'jump': dict(
    headTop=(545, 250), neck=(532, 420), pelvis=(500, 830), shoulderR=(538, 485), shoulderL=(528, 485),
    elbowR=(690, 430), elbowL=(650, 400), wristR=(800, 340), wristL=(760, 310), handR=(845, 310), handL=(805, 280),
    hipR=(506, 870), hipL=(496, 870), kneeR=(670, 945), kneeL=(640, 1000), ankleR=(575, 1085), ankleL=(548, 1130),
    toeR=(672, 1105), toeL=(645, 1150)),
}

def draw_pose(d, lm, c):
    P = lambda k: lm[k]
    # arti lontani (L) dietro, poi corpo, poi arti vicini (R)
    for side in ('L', 'R'):
        if side == 'R':
            mid = ((P('shoulderL')[0] + P('shoulderR')[0]) / 2, (P('shoulderL')[1] + P('shoulderR')[1]) / 2)
            limb(d, ((mid[0] + P('neck')[0]) / 2, mid[1] - 20), P('pelvis'), 62, 54, c('torso'))
            ell(d, P('pelvis'), 60, 50, c('pelvis'))
            limb(d, (P('neck')[0], P('neck')[1] - 40), P('neck'), 26, 30, c('neck'))
            ell(d, (P('headTop')[0], P('headTop')[1] + 80), 70, 80, c('head'))
        limb(d, P('hip' + side), P('knee' + side), 52, 40, c('thigh' + side))
        limb(d, P('knee' + side), P('ankle' + side), 40, 29, c('shin' + side))
        tx, ty = P('toe' + side); ax, ay = P('ankle' + side)
        limb(d, (ax, ay), (tx, ty), 34, 26, c('foot' + side))
        limb(d, P('shoulder' + side), P('elbow' + side), 30, 25, c('uarm' + side))
        limb(d, P('elbow' + side), P('wrist' + side), 25, 19, c('farm' + side))
        hx, hy = P('hand' + side); wx, wy = P('wrist' + side)
        ell(d, ((hx + wx) / 2, (hy + wy) / 2), 26, 34, c('hand' + side))

def pose_sheet(kinds, mapmode):
    im = Image.new('RGB', (CW * len(kinds), CH), '#f4f5f7' if mapmode else '#ffffff'); d = ImageDraw.Draw(im)
    grey = lambda k: '#aeb4bb'
    c = (lambda k: COL[k]) if mapmode else grey
    for i, k in enumerate(kinds):
        lm = {n: (x + CW * i, y) for n, (x, y) in POSES[k].items()}
        draw_pose(d, lm, c)
    if mapmode:
        for i, k in enumerate(kinds):
            d.text((CW * i + CW // 2, 50), {'climb': 'ARRAMPICATA', 'jump': 'SALTO'}[k] + '  (guarda a destra)', fill='#222', font=font(40), anchor='mm')
            if i: d.line([(CW * i, 0), (CW * i, CH)], fill='#c8ccd2', width=3)
    return im

KINDS = ['climb', 'jump']
smooth(pose_sheet(KINDS, False)).save(os.path.join(OUT, 'guida-pose-extra.png'))
pose_sheet(KINDS, True).save(os.path.join(OUT, 'guida-pose-extra-mappa.png'))

# frazioni (x rispetto al centro del busto, y dalla cima della figura) per i modelli di posizionamento automatico
fr = {}
for k, lm in POSES.items():
    ys = [p[1] for p in lm.values()]; top, bottom = min(ys), max(ys); H = bottom - top
    cx = lm['pelvis'][0] * 0.5 + (lm['shoulderL'][0] + lm['shoulderR'][0]) / 4  # centro del busto
    fr[k] = {n: [round((x - cx) / H, 4), round((y - top) / H, 4)] for n, (x, y) in lm.items()}
print('TEMPLATE_JSON=' + json.dumps(fr))
