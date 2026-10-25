/**
 * Aufgabe 2 – 2D-Geometrie aus Linien mit WebGL
 *
 * Ein Rennrad als Linienzeichnung. Ausgangspunkt ist eine Handskizze auf Karopapier:
 * Die Fixpunkte (Achsen, Tretlager, Steuer- und Sitzrohr, Vorbau, Sattel) wurden dort in
 * Kästchen abgelesen und stehen unten in SKIZZE. Alles Übrige berechnet das Programm daraus
 * ("Procedural Modelling"): Kreise, Zahnkränze, Speichen, Kette und Lenker entstehen in Schleifen.
 * Koordinaten in Millimetern (1 Kästchen = 40 mm, Ursprung = Hinterachse), umgerechnet im Vertex-Shader.
 *
 * Verwendete Primitive: gl.LINES, gl.LINE_STRIP, gl.LINE_LOOP.
 * drawArrays(count) = Anzahl der 2D-Vertices = Länge des Float-Arrays / 2.
 */
(() => {
  "use strict";

  // Geometrie-Werkzeuge
  const TAU = Math.PI * 2;
  const rad = (deg) => (deg * Math.PI) / 180;
  const pol = (c, r, a) => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
  const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
  const unit = (deg) => [Math.cos(rad(deg)), Math.sin(rad(deg))];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const len = (v) => Math.hypot(v[0], v[1]);
  const norm = (v) => [v[0] / len(v), v[1] / len(v)];
  const deg = (r) => (r * 180) / Math.PI;

  /** Kreis als Punktliste (für LINE_LOOP) */
  function circle(c, r, n, a0 = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(pol(c, r, a0 + (i / n) * TAU));
    return pts;
  }

  /** Zahnkranz: je Zahn 4 Punkte (Flanke hoch, Kopf, Flanke runter, Fuß) – für LINE_LOOP */
  function toothedRing(c, rOuter, rInner, teeth, a0 = 0) {
    const pts = [];
    const step = TAU / teeth;
    for (let i = 0; i < teeth; i++) {
      const a = a0 + i * step;
      pts.push(pol(c, rInner, a));
      pts.push(pol(c, rOuter, a + step * 0.22));
      pts.push(pol(c, rOuter, a + step * 0.5));
      pts.push(pol(c, rInner, a + step * 0.72));
    }
    return pts;
  }

  /** Quadratische Bézierkurve (für LINE_STRIP) */
  function bezier(p0, p1, p2, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
    return pts;
  }

  /** Catmull-Rom-Spline durch Stützpunkte (glatte Kurve durch alle Punkte) */
  function spline(points, seg = 8, closed = false) {
    const P = points, n = P.length, out = [];
    const get = (i) => (closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      for (let k = 0; k < seg; k++) {
        const t = k / seg, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((d) => 0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t +
          (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
      }
    }
    if (!closed) out.push(P[n - 1]);
    return out;
  }

  /** Äußere Tangenten zweier Kreise (oben/unten) – für die Kette */
  function outerTangent(c1, r1, c2, r2, side) {
    const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
    const d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx) + side * Math.acos((r1 - r2) / d);
    const n = [Math.cos(ang), Math.sin(ang)];
    return [add(c1, n, r1), add(c2, n, r2)];
  }

  /** Rechteck/Streifen entlang einer Strecke a→b mit Breiten w1/w2 (für LINE_LOOP) */
  function band(a, b, w1, w2) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    return [add(a, n, w1 / 2), add(b, n, w2 / 2), add(b, n, -w2 / 2), add(a, n, -w1 / 2)];
  }

  /** lokales Koordinatensystem: Ursprung o, x-Achse in Richtung deg */
  function place(o, deg, pts) {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return pts.map(([x, y]) => [o[0] + x * c - y * s, o[1] + x * s + y * c]);
  }

  // Fixpunkte aus der Handskizze
  // Auf dem Karopapier abgelesen, in Kästchen. Ursprung = Hinterachse, x nach rechts, y nach oben.
  const K = 40;                          // 1 Kästchen = 40 mm
  const SKIZZE = {
    A: { name: "Hinterachse", p: [0, 0] },
    B: { name: "Vorderachse", p: [26, 0] },
    C: { name: "Tretlager", p: [10, -2.1] },
    D: { name: "Steuerrohr oben", p: [20.5, 11.7] },
    E: { name: "Steuerrohr unten", p: [21.6, 8.4] },
    F: { name: "Sitzrohr oben", p: [5.5, 11.8] },
    G: { name: "Vorbau vorn (Lenker)", p: [22.5, 13.5] },
    H: { name: "Sattelstütze oben", p: [4.65, 15.2] },
  };
  const SKIZZE_MASSE = {                 // Radien und Höhen, ebenfalls in Kästchen
    reifen: 8, felge: 6.25, kettenblatt: 2.75, bremsscheibe: 3, ritzel: 1.35,
    oberrohrHoehe: 11.15, sitzstrebeHoehe: 8.8, vorbauHoehe: 13.5,
  };
  const mm = (key) => [SKIZZE[key].p[0] * K, SKIZZE[key].p[1] * K];

  // Szene (mm) – abgeleitet
  const R_TIRE = SKIZZE_MASSE.reifen * K;
  const R_RIM = SKIZZE_MASSE.felge * K;
  const REAR = mm("A");
  const FRONT = mm("B");
  const BB = mm("C");
  const HT_TOP = mm("D");
  const HT_BOT = mm("E");
  const HT_DIR = norm(sub(HT_BOT, HT_TOP));           // Steuerrohr nach unten
  const UP = [-HT_DIR[0], -HT_DIR[1]];
  const HT_N = [-HT_DIR[1], HT_DIR[0]];              // quer zum Steuerrohr
  const ST_TOP = mm("F");
  const ST_DIR = norm(sub(ST_TOP, BB));                // Sitzrohr nach oben
  // Punkt auf Sitzrohr- bzw. Lenkachse in einer bestimmten Höhe (Kästchen)
  const onSeatTube = (yK) => add(BB, ST_DIR, (yK * K - BB[1]) / ST_DIR[1]);
  const onSteerAxis = (yK) => add(HT_TOP, HT_DIR, (yK * K - HT_TOP[1]) / HT_DIR[1]);
  const SEAT_JUNCTION = onSeatTube(SKIZZE_MASSE.sitzstrebeHoehe);
  const TT_REAR = onSeatTube(SKIZZE_MASSE.oberrohrHoehe);
  const TT_FRONT = onSteerAxis(SKIZZE_MASSE.oberrohrHoehe);
  const GEO = {                                        // für die Webseite
    radstand: FRONT[0] - REAR[0],
    lenkwinkel: deg(Math.atan2(-HT_DIR[1], HT_DIR[0])),
    sitzwinkel: 180 - deg(Math.atan2(ST_DIR[1], ST_DIR[0])),
    radius: R_TIRE,
  };
  const VIEW = { x: -400, y: -400, w: 1800, h: 1100 };
  const GROUND_Y = -R_TIRE;

  const parts = [];                      // { name, group, mode, color, pts }
  const part = (name, group, mode, color, pts) => parts.push({ name, group, mode, color, pts });

  // Raster (Entwurfsgrundlage)
  const GRID = 40;                       // 1 Kästchen = 40 mm
  const grid = [], gridMajor = [];
  for (let x = VIEW.x; x <= VIEW.x + VIEW.w; x += GRID) {
    ((x - VIEW.x) % (GRID * 5) === 0 ? gridMajor : grid).push([x, VIEW.y], [x, VIEW.y + VIEW.h]);
  }
  for (let y = VIEW.y; y <= VIEW.y + VIEW.h; y += GRID) {
    ((y - VIEW.y) % (GRID * 5) === 0 ? gridMajor : grid).push([VIEW.x, y], [VIEW.x + VIEW.w, y]);
  }
  part("Raster, fein (40 mm)", "Raster", "LINES", "grid", grid);
  part("Raster, grob (200 mm)", "Raster", "LINES", "gridMajor", gridMajor);

  // Boden
  const ground = [[-380, GROUND_Y], [1380, GROUND_Y]];
  for (let x = -370; x < 1380; x += 30) ground.push([x, GROUND_Y - 4], [x - 18, GROUND_Y - 22]);   // Schraffur
  part("Boden mit Schraffur", "Umgebung", "LINES", "drive", ground);

  // Laufräder
  function wheel(c, label, isRear) {
    part(`${label}: Reifen außen`, label, "LINE_LOOP", "ink", circle(c, R_TIRE, 144));
    part(`${label}: Reifen innen`, label, "LINE_LOOP", "ink", circle(c, R_TIRE - 21, 144));
    // Profil: kurze, schräg stehende Striche zwischen den Reifenkonturen
    const tread = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU;
      tread.push(pol(c, R_TIRE - 16, a), pol(c, R_TIRE - 5, a + rad(1.2)));
    }
    part(`${label}: Reifenprofil`, label, "LINES", "drive", tread);
    part(`${label}: Felgenflanke (Hochprofil)`, label, "LINE_LOOP", "ink", circle(c, R_RIM, 144));
    // Speichen: 24 Stück, 2-fach gekreuzt (Speiche verlässt die Nabe tangential)
    const spokes = [];
    for (let i = 0; i < 24; i++) {
      const h = (i / 24) * TAU;
      const r = h + rad(i % 2 ? 24 : -24);
      spokes.push(pol(c, 30, h), pol(c, R_RIM, r));
    }
    part(`${label}: 24 Speichen, gekreuzt`, label, "LINES", "ink", spokes);
    part(`${label}: Nabenflansch`, label, "LINE_LOOP", "ink", circle(c, 30, 24));
    part(`${label}: Steckachse`, label, "LINE_LOOP", "detail", circle(c, 9, 12));
    // Ventil unten an der Felge
    const v = rad(-90 + (isRear ? 8 : -8));
    part(`${label}: Ventil`, label, "LINE_STRIP", "detail",
      [pol(c, R_RIM, v - 0.012), pol(c, R_RIM - 24, v - 0.012), pol(c, R_RIM - 32, v), pol(c, R_RIM - 24, v + 0.012), pol(c, R_RIM, v + 0.012)]);

    if (isRear) {
      // Kassette: 5 Ritzel mit echten Zähnezahlen
      // Radien ausgehend vom Ritzelkreis der Skizze (größtes Ritzel)
      const r0 = SKIZZE_MASSE.ritzel * K;
      [[1, 34], [0.86, 28], [0.75, 24], [0.64, 20], [0.54, 17]].forEach(([f, z], k) => {
        const r = r0 * f;
        part(`${label}: Ritzel ${z} Zähne`, label, "LINE_LOOP", "drive", toothedRing(c, r, r - 5, z, k * 0.11));
      });
    } else {
      // Bremsscheibe mit Spider und Kühlschlitzen
      const rd = SKIZZE_MASSE.bremsscheibe * K;
      part(`${label}: Bremsscheibe außen`, label, "LINE_LOOP", "drive", circle(c, rd, 72));
      part(`${label}: Bremsscheibe innen`, label, "LINE_LOOP", "drive", circle(c, rd - 20, 48));
      const arms = [], slots = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        arms.push(pol(c, 18, a), pol(c, rd - 20, a + rad(18)));
      }
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU;
        slots.push(pol(c, rd - 16, a), pol(c, rd - 4, a + rad(9)));
      }
      part(`${label}: Bremsscheiben-Spider`, label, "LINES", "drive", arms);
      part(`${label}: Kühlschlitze`, label, "LINES", "drive", slots);
    }
  }
  wheel(REAR, "Hinterrad", true);
  wheel(FRONT, "Vorderrad", false);

  // Antrieb
  const R_RING = SKIZZE_MASSE.kettenblatt * K;
  part("Kettenblatt, 52 Zähne", "Antrieb", "LINE_LOOP", "drive", toothedRing(BB, R_RING, R_RING - 7, 52));
  part("Kettenblatt innen", "Antrieb", "LINE_LOOP", "drive", circle(BB, R_RING - 22, 64));
  const spider = [];
  for (let i = 0; i < 4; i++) {
    const a = rad(45 + i * 90);
    spider.push(pol(BB, 24, a - 0.25), pol(BB, R_RING - 22, a - 0.06), pol(BB, 24, a + 0.25), pol(BB, R_RING - 22, a + 0.06));
  }
  part("Kurbelstern (4 Arme)", "Antrieb", "LINES", "drive", spider);

  // Kette oben: Laschen als zwei parallele Linien, Rollen als Querstriche (Teilung 12,7 mm)
  function chain(a, b, out, rollers) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n = [-d[1], d[0]];
    out.push(add(a, n, 4), add(b, n, 4), add(a, n, -4), add(b, n, -4));
    for (let s = 6; s < len - 3; s += 12.7) {
      const p = add(a, d, s);
      rollers.push(add(p, n, 4), add(p, n, -4));
    }
  }
  const [cTopA, cTopB] = outerTangent(REAR, SKIZZE_MASSE.ritzel * K * 0.8, BB, R_RING, 1);
  const plates = [], rollers = [];
  chain(cTopA, cTopB, plates, rollers);

  // Schaltwerk mit zwei Schaltröllchen; Kette unten läuft S-förmig darüber
  const U = [26, -66], L = [56, -126];
  part("Schaltröllchen oben", "Antrieb", "LINE_LOOP", "drive", toothedRing(U, 14, 11, 11));
  part("Schaltröllchen unten", "Antrieb", "LINE_LOOP", "drive", toothedRing(L, 14, 11, 11, 0.2));
  part("Schaltwerkkäfig", "Antrieb", "LINE_LOOP", "ink",
    spline([add(U, [-12, 22]), add(U, [22, 12]), add(L, [26, 4]), add(L, [8, -26]), add(L, [-24, -6]), add(U, [-22, -4])], 6, true));
  part("Schaltauge", "Antrieb", "LINE_STRIP", "ink", [[6, -12], [20, -36], add(U, [-4, 20])]);
  const [cBotA, cBotB] = outerTangent(L, 14, BB, R_RING, -1);
  chain(cBotA, cBotB, plates, rollers);
  chain(add(L, [-14, 0]), add(U, [14, -2]), plates, rollers);
  part("Kette: Laschen", "Antrieb", "LINES", "drive", plates);
  part("Kette: Rollen", "Antrieb", "LINES", "drive", rollers);

  // Kurbel und Pedal
  const CRANK_END = add(BB, unit(-62), 172);
  part("Kurbelarm", "Antrieb", "LINE_LOOP", "ink", band(BB, CRANK_END, 34, 22));
  part("Pedal", "Antrieb", "LINE_LOOP", "ink", place(CRANK_END, 0, [[-48, -9], [48, -9], [52, 0], [48, 9], [-48, 9], [-52, 0]]));
  part("Pedalachse", "Antrieb", "LINE_LOOP", "detail", circle(CRANK_END, 7, 10));
  part("Tretlager", "Antrieb", "LINE_LOOP", "detail", circle(BB, 14, 16));

  // Rahmen
  const DT_FRONT = add(HT_BOT, UP, 22);
  // Rohre als zwei Kanten (konisch): von Knoten a nach Knoten b, an beiden Enden um tA/tB gekürzt,
  // damit die Rohre an Tretlagergehäuse, Steuerrohr und Ausfallenden ansetzen statt hineinzuragen
  function tubeEdges(a, b, tA, tB, w1, w2) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const [p1, p2, p3, p4] = band(add(a, d, tA), add(b, d, -tB), w1, w2);
    return [p1, p2, p4, p3];
  }
  part("Unterrohr", "Rahmen", "LINES", "frame", tubeEdges(BB, DT_FRONT, 26, 28, 42, 38));
  part("Sitzrohr", "Rahmen", "LINES", "frame", tubeEdges(BB, ST_TOP, 26, 0, 34, 30));
  part("Oberrohr", "Rahmen", "LINES", "frame", tubeEdges(TT_REAR, TT_FRONT, 15, 28, 28, 30));
  part("Kettenstrebe", "Rahmen", "LINES", "frame", tubeEdges(REAR, BB, 18, 26, 16, 26));
  part("Sitzstrebe", "Rahmen", "LINES", "frame", tubeEdges(REAR, SEAT_JUNCTION, 18, 14, 14, 20));
  part("Steuerrohr", "Rahmen", "LINE_LOOP", "frame", band(HT_TOP, HT_BOT, 52, 58));
  // Gabel: zwei Bézierkurven (Vorder- und Hinterkante der Gabelscheide) von E nach B
  const CROWN = add(HT_BOT, HT_DIR, 8);
  const FORK_MID = lerp(CROWN, FRONT, 0.5);
  part("Gabel vorne", "Rahmen", "LINE_STRIP", "frame", bezier(add(CROWN, HT_N, -20), add(FORK_MID, HT_N, -12), add(FRONT, [6, 4]), 20));
  part("Gabel hinten", "Rahmen", "LINE_STRIP", "frame", bezier(add(CROWN, HT_N, 20), add(FORK_MID, HT_N, 4), add(FRONT, [-6, 6]), 20));
  part("Ausfallende hinten", "Rahmen", "LINE_LOOP", "frame", circle(REAR, 18, 16));
  part("Ausfallende vorne", "Rahmen", "LINE_LOOP", "frame", circle(FRONT, 18, 16));
  part("Tretlagergehäuse", "Rahmen", "LINE_LOOP", "frame", circle(BB, 26, 24));

  // Bremssattel vorne
  part("Bremssattel", "Rahmen", "LINE_LOOP", "ink", place(pol(FRONT, SKIZZE_MASSE.bremsscheibe * K - 8, rad(112)), 22, [[-30, -12], [30, -12], [34, 0], [30, 12], [-30, 12], [-34, 0]]));

  // Trinkflasche im Halter auf dem Unterrohr
  const dtAng = Math.atan2(DT_FRONT[1] - BB[1], DT_FRONT[0] - BB[0]) * 180 / Math.PI;
  const BOTTLE_O = add(lerp(BB, DT_FRONT, 0.24), unit(dtAng + 90), 62);
  part("Trinkflasche", "Rahmen", "LINE_LOOP", "detail", place(BOTTLE_O, dtAng,
    spline([[-2, -26], [6, -32], [140, -32], [164, -20], [180, -13], [194, -13], [194, 13], [180, 13], [164, 20], [140, 32], [6, 32], [-2, 26]], 4, true)));
  part("Flaschenhalter", "Rahmen", "LINE_STRIP", "ink", place(BOTTLE_O, dtAng, [[28, 20], [28, -38], [118, -38], [118, 20]]));

  // Sattel und Cockpit
  const POST_TOP = mm("H");
  part("Sattelstütze", "Cockpit", "LINE_LOOP", "ink", band(add(ST_TOP, ST_DIR, -20), POST_TOP, 26, 24));
  const [sx, sy] = POST_TOP;
  part("Sattel", "Cockpit", "LINE_LOOP", "ink", spline([
    [sx - 158, sy + 14], [sx - 140, sy + 28], [sx - 40, sy + 27], [sx + 60, sy + 25], [sx + 114, sy + 22],
    [sx + 118, sy + 8], [sx + 40, sy + 2], [sx - 60, sy + 1], [sx - 150, sy + 3]], 6, true));
  part("Sattelstreben", "Cockpit", "LINE_STRIP", "drive", [[sx - 100, sy + 2], [sx - 70, sy - 8], [sx + 50, sy - 8], [sx + 80, sy + 2]]);

  // Gabelschaft mit Spacern bis zur Vorbauhöhe der Skizze
  const STEM_A = onSteerAxis(SKIZZE_MASSE.vorbauHoehe);
  const STEM_B = mm("G");
  const spacers = [];
  for (let k = 0; k <= len(sub(STEM_A, HT_TOP)) - 14; k += 10) {
    const m = add(HT_TOP, UP, k);
    spacers.push(add(m, HT_N, 20), add(m, HT_N, -20));
  }
  part("Spacer", "Cockpit", "LINES", "ink", spacers);
  part("Gabelschaft", "Cockpit", "LINE_LOOP", "ink", band(HT_TOP, add(STEM_A, UP, 18), 40, 40));
  part("Vorbau", "Cockpit", "LINE_LOOP", "ink", band(STEM_A, STEM_B, 36, 30));
  const [bx, by] = STEM_B;
  const bar = spline([[bx, by], [bx + 20, by - 4], [bx + 34, by - 24], [bx + 34, by - 54], [bx + 22, by - 76],
    [bx, by - 86], [bx - 24, by - 82]], 8);
  part("Rennlenker (Drop Bar)", "Cockpit", "LINE_STRIP", "ink", bar);
  part("Lenkerband-Wicklung", "Cockpit", "LINES", "drive", bar.slice(8, -4).filter((_, i) => i % 3 === 0)
    .flatMap((p, i, a) => {
      const q = a[i + 1] || bar[bar.length - 4];
      const d = [q[0] - p[0], q[1] - p[1]]; const l = Math.hypot(...d) || 1;
      const n = [-d[1] / l, d[0] / l];
      return [add(p, n, 9), add(p, n, -9)];
    }));
  part("Schaltbremsgriff", "Cockpit", "LINE_LOOP", "ink", spline([[bx + 8, by + 2], [bx + 24, by + 16], [bx + 38, by + 6], [bx + 36, by - 14], [bx + 22, by - 8]], 6, true));
  part("Bremshebel", "Cockpit", "LINE_STRIP", "ink", bezier([bx + 30, by - 4], [bx + 52, by - 40], [bx + 62, by - 80], 12));

  // Schaltzug/Bremsleitung vom Lenker zum Unterrohr
  part("Bremsleitung", "Cockpit", "LINE_STRIP", "drive", bezier([bx + 24, by - 20], [bx + 70, by - 190], add(add(HT_TOP, HT_DIR, 50), HT_N, 30), 18));

  // WebGL
  const canvas = document.getElementById("gl");
  const status = document.getElementById("status");
  const setStatus = (t, err = false) => { status.textContent = t; status.classList.toggle("is-error", err); };

  const VS = `
    attribute vec2 aPosition;
    uniform vec4 uView;            // x, y, Breite, Höhe des sichtbaren Bereichs in mm
    void main() {
      vec2 p = (aPosition - uView.xy) / uView.zw;   // 0..1
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);  // -1..1 (Clip Space)
    }`;
  const FS = `
    precision mediump float;
    uniform vec4 uColor;
    void main() { gl_FragColor = uColor; }`;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`Shader-Fehler: ${gl.getShaderInfoLog(sh)}`);
    }
    return sh;
  }

  function hexColor(varName) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (!m) return [0, 0, 0, 1];
    const n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1];
  }

  let gl, program, loc, lineRange = [1, 1];
  const drawCalls = [];

  function init() {
    gl = canvas.getContext("webgl", { antialias: true });
    if (!gl) throw new Error("Ihr Browser unterstützt kein WebGL. Bitte aktivieren Sie die Hardwarebeschleunigung.");

    program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Programm-Fehler: ${gl.getProgramInfoLog(program)}`);
    gl.useProgram(program);

    // Alle Teile in EIN Array schreiben, pro Teil Startindex und Anzahl merken
    const vertices = [];
    parts.forEach((p) => {
      drawCalls.push({ ...p, first: vertices.length / 2, count: p.pts.length });
      p.pts.forEach(([x, y]) => vertices.push(x, y));
    });

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

    loc = {
      pos: gl.getAttribLocation(program, "aPosition"),
      view: gl.getUniformLocation(program, "uView"),
      color: gl.getUniformLocation(program, "uColor"),
    };
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);   // 2 Werte = 1 Vertex
    gl.uniform4f(loc.view, VIEW.x, VIEW.y, VIEW.w, VIEW.h);

    lineRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE);
  }

  function draw() {
    // Zeichenfläche an die tatsächliche Größe anpassen (scharfe Linien, auch auf Retina)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);

    const colors = {
      bg: hexColor("--gl-bg"), grid: hexColor("--gl-grid"), gridMajor: hexColor("--gl-grid-major"),
      ink: hexColor("--gl-ink"), frame: hexColor("--gl-frame"), drive: hexColor("--gl-drive"), detail: hexColor("--gl-detail"),
    };
    gl.clearColor(...colors.bg);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const showGrid = document.getElementById("toggle-grid").checked;
    // Breitere Linien nur, wenn der Browser sie unterstützt (Chrome/macOS: meist nur 1)
    const wide = Math.min(2 * dpr, lineRange[1]);

    drawCalls.forEach((d) => {
      if (d.group === "Raster" && !showGrid) return;
      gl.lineWidth(d.color === "frame" ? wide : 1);
      gl.uniform4fv(loc.color, colors[d.color]);
      gl.drawArrays(gl[d.mode], d.first, d.count);      // count = Anzahl 2D-Vertices
    });

    const err = gl.getError();
    if (err !== gl.NO_ERROR) console.error(`WebGL-Fehler 0x${err.toString(16)}`);
  }

  // Tabelle und Kennzahlen
  function renderStats() {
    const geo = drawCalls.filter((d) => d.group !== "Raster");
    const total = geo.reduce((s, d) => s + d.count, 0);
    const byMode = { LINES: 0, LINE_STRIP: 0, LINE_LOOP: 0 };
    geo.forEach((d) => (byMode[d.mode] += d.count));

    document.getElementById("stat-vertices").textContent = total.toLocaleString("de-DE");
    document.getElementById("stat-parts").textContent = geo.length;
    document.getElementById("stat-modes").textContent =
      `${byMode.LINES.toLocaleString("de-DE")} / ${byMode.LINE_STRIP.toLocaleString("de-DE")} / ${byMode.LINE_LOOP.toLocaleString("de-DE")}`;
    document.getElementById("line-range").textContent =
      lineRange[1] > 1 ? `${lineRange[0]} bis ${lineRange[1]} px – breitere Linien für den Rahmen sind aktiv.`
                       : `${lineRange[0]} bis ${lineRange[1]} px – dieser Browser zeichnet alle Linien 1 px breit.`;

    const tbody = document.getElementById("parts-body");
    const groups = [...new Set(geo.map((d) => d.group))];
    groups.forEach((g) => {
      const rows = geo.filter((d) => d.group === g);
      rows.forEach((d, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${i === 0 ? g : ""}</td><td>${d.name}</td><td><code>gl.${d.mode}</code></td><td class="num">${d.count}</td>`;
        tbody.appendChild(tr);
      });
    });
    document.getElementById("parts-total").textContent = total.toLocaleString("de-DE");
    document.getElementById("canvas-desc").textContent =
      `Linienzeichnung eines Rennrads in Seitenansicht aus ${total.toLocaleString("de-DE")} Vertices in ${geo.length} Teilen: ` +
      "Laufräder mit gekreuzten Speichen, Reifenprofil, Kassette und Bremsscheibe, Rahmen mit Gabel und Trinkflasche, " +
      "Kettenblatt mit 52 Zähnen, Kette, Schaltwerk, Sattel und Rennlenker, auf einem Millimeterraster.";
    renderSketchTable();
  }

  // Fixpunkte der Skizze als Tabelle
  function renderSketchTable() {
    const f = (v, max = 2) => v.toLocaleString("de-DE", { maximumFractionDigits: max });
    const tbody = document.getElementById("fix-body");
    Object.entries(SKIZZE).forEach(([key, { name, p }]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<th scope="row">${key}</th><td>${name}</td>` +
        `<td class="num">(${f(p[0])} | ${f(p[1])})</td><td class="num">(${f(p[0] * K, 0)} | ${f(p[1] * K, 0)})</td>`;
      tbody.appendChild(tr);
    });
    document.getElementById("geo-radstand").textContent = `${f(GEO.radstand, 0)} mm`;
    document.getElementById("geo-lenkwinkel").textContent = `${f(GEO.lenkwinkel, 1)}°`;
    document.getElementById("geo-sitzwinkel").textContent = `${f(GEO.sitzwinkel, 1)}°`;
    document.getElementById("geo-radius").textContent = `${f(GEO.radius, 0)} mm`;
  }

  // Handskizze überlagern
  const overlay = document.getElementById("sketch-overlay");
  const toggleSketch = document.getElementById("toggle-sketch");
  toggleSketch.addEventListener("change", () => {
    overlay.hidden = !toggleSketch.checked;
    setStatus(toggleSketch.checked ? "Handskizze liegt über der WebGL-Zeichnung." : "");
  });
  overlay.addEventListener("error", () => {
    toggleSketch.checked = false;
    toggleSketch.disabled = true;
    overlay.hidden = true;
    setStatus("Die Datei img/entwurf.jpg fehlt – die Skizze kann nicht überlagert werden.", true);
  });

  // Design hell / dunkel
  const themeSwitch = document.getElementById("theme-switch");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* privater Modus */ } },
  };
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    themeSwitch.setAttribute("aria-checked", String(t === "dark"));
    if (gl) draw();
  }
  themeSwitch.addEventListener("click", () => {
    const next = themeSwitch.getAttribute("aria-checked") === "true" ? "light" : "dark";
    applyTheme(next);
    store.set("theme", next);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!store.get("theme")) applyTheme(e.matches ? "dark" : "light");
  });

  // Start
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  try {
    init();
    renderStats();
    draw();
    new ResizeObserver(() => draw()).observe(canvas);
    document.getElementById("toggle-grid").addEventListener("change", draw);
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); setStatus("WebGL-Kontext verloren – bitte Seite neu laden.", true); });
    setStatus("");
    console.info(`WebGL-Linien: ${drawCalls.length} drawArrays-Aufrufe, Linienbreiten ${lineRange[0]}–${lineRange[1]} px.`);
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
  }
})();
