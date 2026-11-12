#!/usr/bin/env python3
"""Guide for the paper-puppet ("burattino") parts sheet.
Produces docs/guida-di-prova/guida-burattino.png (with measures), guida-burattino-pulita.png (silhouettes only, for the AI)
and guida-burattino-layout.json (slot rectangles + joint pivots, read by the importer)."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'guida-di-prova')
W, H = 2048, 1536
THREE_Q = '--34' in sys.argv      # 3/4 variant: deeper head, torso and pelvis (the body is turned a little toward the viewer)
FRONT, BACK = '--front' in sys.argv, '--back' in sys.argv      # frontal variants: the camera sees the character from the front / the back
FRONTAL = FRONT or BACK
S = 1.0 if FRONTAL else 1.3                      # canvas px per unit; a standing figure is 1000 units = 1300 px tall
PADX, PADY = 30, 64          # slot margin around the silhouette (px); the top/bottom margins hold the label and the measures

# id, label, bone, w, h (units, INCLUDING the overlap past the joints), shape, proximal pivot, distal pivot (units, inside the piece)
PARTS = [
  ('head',   'TESTA (con cappello o capelli)', 'head',   225 if THREE_Q else 200, 240, 'head',  (100 if THREE_Q else 95, 205), (105 if THREE_Q else 100, 8)),
  ('torso',  'BUSTO (senza braccia)',        'torso',  235 if THREE_Q else 190, 350, 'torso', (118 if THREE_Q else 95, 305), (118 if THREE_Q else 95, 40)),
  ('pelvis', 'BACINO',                       'pelvis', 215 if THREE_Q else 180, 140, 'torso', (108 if THREE_Q else 90, 55),  (108 if THREE_Q else 90, 105)),
  ('uarm',   'BRACCIO',                      'uarmR',   70, 210, 'limb',  (35, 35),  (35, 175)),
  ('farm',   'AVAMBRACCIO',                  'farmR',   62, 200, 'limb',  (31, 31),  (31, 165)),
  ('hand',   'MANO',                         'handR',   70, 100, 'limb',  (35, 25),  (35, 92)),
  ('thigh',  'COSCIA',                       'thighR', 100, 270, 'limb',  (50, 50),  (50, 220)),
  ('shin',   'GAMBA (stinco)',               'shinR',   80, 270, 'limb',  (40, 40),  (40, 230)),
  ('foot',   'PIEDE (punta a destra)',       'footR',  170,  70, 'foot',  (45, 25),  (160, 55)),
  ('accA',   'ZAINO (dietro al busto)',      None,     200, 260, 'free',  None, None),
  ('accB',   'BRETELLA (sul busto)',         None,     110, 300, 'free',  None, None),
]

if FRONTAL:
    # front/back view: wide torso/pelvis, limbs drawn ONCE (the app mirrors them for the other side); the foot is seen from the front
    PARTS = [
      ('head',   'TESTA (con cappello o capelli)' + (', di fronte' if FRONT else ', di nuca'), 'head', 195, 240, 'head', (97, 205), (97, 8)),
      ('torso',  'BUSTO (senza braccia)', 'torso', 250, 350, 'torso', (125, 305), (125, 40)),
      ('pelvis', 'BACINO', 'pelvis', 240, 140, 'torso', (120, 55), (120, 105)),
      ('uarm',   'BRACCIO (solo spalla-gomito)', 'uarmR', 80, 210, 'limb', (40, 40), (40, 175)),
      ('farm',   'AVAMBRACCIO (solo gomito-polso)', 'farmR', 70, 200, 'limb', (35, 35), (35, 165)),
      ('hand',   'MANO (solo la mano)', 'handR', 80, 100, 'limb', (40, 25), (40, 92)),
      ('thigh',  'COSCIA (solo anca-ginocchio)', 'thighR', 112, 270, 'limb', (56, 52), (56, 220)),
      ('shin',   'GAMBA (solo ginocchio-caviglia)', 'shinR', 92, 270, 'limb', (46, 44), (46, 230)),
      ('foot',   'PIEDE (da %s)' % ('davanti' if FRONT else 'dietro'), 'footR', 100, 130, 'limb', (50, 30), (50, 115)),
      ('accA',   'ZAINO (visibile da dietro)' if BACK else 'ZAINO (nascosto, facoltativo)', None, 230, 260, 'free', None, None),
      ('accB',   'BRETELLE (sul busto)' if FRONT else 'ACCESSORIO (facoltativo)', None, 150, 300, 'free', None, None),
    ]

if FRONTAL:
    # each limb piece is drawn TWICE, once per side (different sleeve/glove/boot details, no mirroring)
    R = [p for p in PARTS if p[0] in ('uarm', 'farm', 'hand', 'thigh', 'shin', 'foot')]
    PARTS = [(p[0], p[1].replace(' (', ' dx (', 1), p[2], *p[3:]) if p in R else p for p in PARTS]
    for p in R:
        PARTS.append((p[0] + 'L', p[1].replace(' (', ' sx (', 1), p[2][:-1] + 'L', *p[3:]))

def font(sz, bold=False):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf' % ('-Bold' if bold else '')]:
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default()

# rows of slots (shelf layout)
ROWS = [['head', 'torso', 'pelvis', 'accA', 'accB'], ['uarm', 'farm', 'hand', 'thigh', 'shin', 'foot']]
if FRONTAL: ROWS.append(['uarmL', 'farmL', 'handL', 'thighL', 'shinL', 'footL'])
byid = {p[0]: p for p in PARTS}
layout = {'canvas': {'width': W, 'height': H}, 'unitPx': S, 'standingHeightPx': round(1000 * S), 'parts': {}}
y = 110
for row in ROWS:
    x = 40
    rowh = 0
    for pid in row:
        _, label, bone, uw, uh, shape, prox, dist = byid[pid]
        pw, ph = round(uw * S), round(uh * S)
        sw, sh = max(pw + 2 * PADX, 215 if FRONTAL else 190), ph + 2 * PADY
        piece = {'x': x + (sw - pw) // 2, 'y': y + PADY, 'w': pw, 'h': ph}
        layout['parts'][pid] = {
            'label': label, 'bone': bone, 'shape': shape,
            'slot': {'x': x, 'y': y, 'w': sw, 'h': sh}, 'piece': piece,
            'proximal': None if prox is None else {'x': piece['x'] + round(prox[0] * S), 'y': piece['y'] + round(prox[1] * S)},
            'distal': None if dist is None else {'x': piece['x'] + round(dist[0] * S), 'y': piece['y'] + round(dist[1] * S)},
        }
        x += sw + 20
        rowh = max(rowh, sh)
    assert x - 20 <= W - 40, f'row too wide: {x}'
    y += rowh + 40
assert y - 40 <= H - 60, f'canvas too short: {y}'

def silhouette(d, p, fill, outline):
    pc = p['piece']; x0, y0, x1, y1 = pc['x'], pc['y'], pc['x'] + pc['w'], pc['y'] + pc['h']
    sh = p['shape']
    if sh == 'head': d.ellipse([x0, y0, x1, y1], fill=fill, outline=outline, width=3)
    elif sh == 'torso': d.rounded_rectangle([x0, y0, x1, y1], radius=int(pc['w'] * 0.28), fill=fill, outline=outline, width=3)
    elif sh == 'limb': d.rounded_rectangle([x0, y0, x1, y1], radius=int(pc['w'] / 2), fill=fill, outline=outline, width=3)
    elif sh == 'foot': d.rounded_rectangle([x0, y0, x1, y1], radius=int(pc['h'] / 2), fill=fill, outline=outline, width=3)
    else: d.rounded_rectangle([x0, y0, x1, y1], radius=20, fill=None, outline=outline, width=3)

def render(annotated):
    im = Image.new('RGB', (W, H), (255, 255, 255)); d = ImageDraw.Draw(im)
    for pid, p in layout['parts'].items():
        s = p['slot']
        if annotated: d.rectangle([s['x'], s['y'], s['x'] + s['w'], s['y'] + s['h']], outline=(170, 170, 170), width=2)
        silhouette(d, p, (214, 214, 214) if p['shape'] != 'free' else None, (90, 90, 90))
        if not annotated: continue
        pc = p['piece']; u = byid[pid]
        name, _, extra = p['label'].partition(' (')
        d.text((s['x'] + 8, s['y'] + 6), name, fill=(20, 20, 20), font=font(22, True))
        if extra: d.text((s['x'] + 8, s['y'] + 34), '(' + extra, fill=(90, 90, 90), font=font(15))
        d.text((s['x'] + 8, s['y'] + s['h'] - 52), f"{pc['w']} x {pc['h']} px", fill=(30, 30, 30), font=font(20, True))
        d.text((s['x'] + 8, s['y'] + s['h'] - 26), f"({u[3]} x {u[4]} unità)", fill=(100, 100, 100), font=font(16))
        for key, col in (('proximal', (220, 30, 30)), ('distal', (30, 90, 220))):
            q = p[key]
            if q:
                d.line([q['x'] - 14, q['y'], q['x'] + 14, q['y']], fill=col, width=3); d.line([q['x'], q['y'] - 14, q['x'], q['y'] + 14], fill=col, width=3)
                d.ellipse([q['x'] - 6, q['y'] - 6, q['x'] + 6, q['y'] + 6], outline=col, width=3)
    if annotated:
        d.text((50, 30), ('GUIDA BURATTINO DI FRONTE' if FRONT else 'GUIDA BURATTINO DI SCHIENA' if BACK else 'GUIDA BURATTINO 3/4' if THREE_Q else 'GUIDA BURATTINO') + (' — pezzi dritti, ogni segmento di arto separato, per ciascun lato (dx e sx dell\'immagine).' if FRONTAL else ' — vista laterale (destra), pezzi dritti e non ruotati.'), fill=(0, 0, 0), font=font(26, True))
        d.text((50, 64), 'Croce ROSSA = snodo con il pezzo precedente (prossimale).  Croce BLU = snodo con il pezzo successivo (distale).  Il disegno deve proseguire oltre lo snodo (estremità arrotondata).', fill=(60, 60, 60), font=font(21))
        d.text((50, H - 50), 'Le sagome grigie indicano posizione e proporzioni: i pezzi devono stare DENTRO la propria casella, senza toccare i bordi.  1 unità = 1/1000 dell\'altezza in piedi (1000 u = %d px).' % layout['standingHeightPx'], fill=(60, 60, 60), font=font(22))
    return im

os.makedirs(OUT, exist_ok=True)
sfx = '-fronte' if FRONT else '-retro' if BACK else '-34' if THREE_Q else ''
render(True).save(os.path.join(OUT, f'guida-burattino{sfx}.png'))
render(False).save(os.path.join(OUT, f'guida-burattino{sfx}-pulita.png'))
json.dump(layout, open(os.path.join(OUT, f'guida-burattino{sfx}-layout.json'), 'w'), indent=1, ensure_ascii=False)
print('ok', layout['standingHeightPx'])
