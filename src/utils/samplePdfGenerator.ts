interface SamplePageSpec {
  pageNum: number;
  chapter: string;
  section: string;
  title: string;
  body: string[];
  diagram: 'slope' | 'two-body' | 'friction-slope' | 'board' | 'spring' | 'cylinder';
}

const SAMPLE_PAGES: SamplePageSpec[] = [
  {
    pageNum: 1,
    chapter: '第1章 力学',
    section: '運動の法則',
    title: '基本例題 12　なめらかな斜面上の運動',
    body: [
      '傾角 θ のなめらかな斜面上に質量 m の物体を静かに置いた。',
      '重力加速度の大きさを g とする。',
      '',
      '(1) 物体が斜面から受ける垂直抗力の大きさ N を求めよ。',
      '(2) 物体の斜面に沿った加速度の大きさ a を求めよ。',
    ],
    diagram: 'slope',
  },
  {
    pageNum: 2,
    chapter: '第1章 力学',
    section: '運動の法則',
    title: '基本問題 42　2物体の運動方程式',
    body: [
      'なめらかな水平面上に質量 2.0 kg の物体Aと 3.0 kg の物体Bを',
      '接触させて置き、Aの左端から水平右向きに 15 N の力を加えた。',
      '',
      '(1) A, B の加速度の大きさ a を求めよ。',
      '(2) AがBを押す力の大きさ f を求めよ。',
    ],
    diagram: 'two-body',
  },
  {
    pageNum: 3,
    chapter: '第1章 力学',
    section: '摩擦力',
    title: '基本問題 43　あらい斜面をすべり上がる運動',
    body: [
      '傾角 30° のあらい斜面上に質量 m の物体を置き、初速度 v₀ で',
      '斜面上向きにすべらせた。動摩擦係数を μ′ とする。',
      '',
      '(1) 上昇中の加速度の大きさ a を求めよ。',
      '(2) 最高点に達するまでの距離 L を求めよ。',
    ],
    diagram: 'friction-slope',
  },
  {
    pageNum: 4,
    chapter: '第1章 力学',
    section: '摩擦力',
    title: '基本問題 44　板の上をすべる小物体',
    body: [
      'なめらかな水平面上に質量 M の長い板を置き、その上に質量 m の',
      '小物体を載せた。板を水平右向きに一定の力 F で引くとき、',
      '小物体が板の上をすべり出す最小の力 F₀ を求めよ。',
      '板と小物体の間の静止摩擦係数を μ とする。',
    ],
    diagram: 'board',
  },
  {
    pageNum: 5,
    chapter: '第1章 力学',
    section: '仕事とエネルギー',
    title: '発展例題 5　ばねと動摩擦力',
    body: [
      'ばね定数 k の軽いばねの一端を壁に固定し、他端に質量 m の',
      '物体をつけて自然長から d だけ押し縮めて静かに放した。',
      'ばねが自然長に戻った点から先が動摩擦係数 μ′ のあらい水平面',
      'であるとき、物体が止まるまでに進む距離 x を求めよ。',
    ],
    diagram: 'spring',
  },
  {
    pageNum: 6,
    chapter: '第1章 力学',
    section: '仕事とエネルギー',
    title: '発展問題 51　半円筒面上の運動',
    body: [
      '水平面上に固定された半径 r のなめらかな半円筒面の頂点に',
      '質量 m の小球を置き、わずかに動かしてすべり落とさせた。',
      '',
      '(1) 鉛直方向から測った角度 θ の位置での速さ v を求めよ。',
      '(2) 小球が面から離れる瞬間の cosθ の値を求めよ。',
    ],
    diagram: 'cylinder',
  },
];

function drawDiagram(
  ctx: CanvasRenderingContext2D,
  kind: SamplePageSpec['diagram'],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.strokeStyle = '#334155';
  ctx.fillStyle = '#334155';
  ctx.lineWidth = 2.2;

  if (kind === 'slope' || kind === 'friction-slope') {
    const x1 = x + 40;
    const y1 = y + h - 30;
    const x2 = x + w - 40;
    const y2 = y1;
    const x3 = x2;
    const y3 = y + 40;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.stroke();

    // Box on slope
    ctx.save();
    ctx.translate((x1 + x3) * 0.52, (y1 + y3) * 0.48 - 18);
    ctx.rotate(-0.46);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(-24, -18, 48, 32);
    ctx.strokeRect(-24, -18, 48, 32);
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('m', -8, 4);
    ctx.restore();

    ctx.font = '16px sans-serif';
    ctx.fillText(kind === 'slope' ? 'θ' : '30°', x1 + 52, y1 - 12);
  } else if (kind === 'two-body') {
    const floorY = y + h - 40;
    ctx.beginPath();
    ctx.moveTo(x + 30, floorY);
    ctx.lineTo(x + w - 30, floorY);
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(x + 140, floorY - 56, 68, 56);
    ctx.strokeRect(x + 140, floorY - 56, 68, 56);
    ctx.fillRect(x + 208, floorY - 68, 92, 68);
    ctx.strokeRect(x + 208, floorY - 68, 92, 68);

    // Arrow F
    ctx.strokeStyle = '#2563eb';
    ctx.beginPath();
    ctx.moveTo(x + 70, floorY - 28);
    ctx.lineTo(x + 134, floorY - 28);
    ctx.lineTo(x + 122, floorY - 35);
    ctx.moveTo(x + 134, floorY - 28);
    ctx.lineTo(x + 122, floorY - 21);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('A (2.0kg)', x + 145, floorY - 22);
    ctx.fillText('B (3.0kg)', x + 220, floorY - 28);
    ctx.fillStyle = '#2563eb';
    ctx.fillText('15 N', x + 76, floorY - 40);
  } else if (kind === 'board') {
    const floorY = y + h - 36;
    ctx.beginPath();
    ctx.moveTo(x + 30, floorY);
    ctx.lineTo(x + w - 30, floorY);
    ctx.stroke();

    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(x + 100, floorY - 30, 220, 30);
    ctx.strokeRect(x + 100, floorY - 30, 220, 30);

    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(x + 130, floorY - 72, 54, 42);
    ctx.strokeRect(x + 130, floorY - 72, 54, 42);

    ctx.strokeStyle = '#2563eb';
    ctx.beginPath();
    ctx.moveTo(x + 320, floorY - 15);
    ctx.lineTo(x + 385, floorY - 15);
    ctx.lineTo(x + 373, floorY - 22);
    ctx.moveTo(x + 385, floorY - 15);
    ctx.lineTo(x + 373, floorY - 8);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('m', x + 150, floorY - 45);
    ctx.fillText('M', x + 205, floorY - 9);
    ctx.fillStyle = '#2563eb';
    ctx.fillText('F', x + 392, floorY - 10);
  } else if (kind === 'spring') {
    const floorY = y + h - 40;
    const wallX = x + 60;
    ctx.beginPath();
    ctx.moveTo(wallX, y + 30);
    ctx.lineTo(wallX, floorY);
    ctx.lineTo(x + w - 30, floorY);
    ctx.stroke();

    // Spring zig-zag
    ctx.beginPath();
    ctx.moveTo(wallX, floorY - 26);
    for (let i = 0; i < 8; i++) {
      const sx = wallX + 14 + i * 14;
      const sy = floorY - 26 + (i % 2 === 0 ? -10 : 10);
      ctx.lineTo(sx, sy);
    }
    ctx.lineTo(wallX + 130, floorY - 26);
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(wallX + 130, floorY - 52, 52, 52);
    ctx.strokeRect(wallX + 130, floorY - 52, 52, 52);
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('m', wallX + 149, floorY - 20);
    ctx.font = '14px sans-serif';
    ctx.fillText('ばね定数 k', wallX + 24, floorY - 52);
  } else if (kind === 'cylinder') {
    const cx = x + w * 0.5;
    const cy = y + h - 25;
    const r = 105;
    ctx.beginPath();
    ctx.moveTo(x + 40, cy);
    ctx.lineTo(x + w - 40, cy);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.stroke();

    // Ball near top
    const angle = -Math.PI / 2 + 0.55;
    const bx = cx + Math.cos(angle) * (r + 12);
    const by = cy + Math.sin(angle) * (r + 12);
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.arc(bx, by, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - r - 20);
    ctx.moveTo(cx, cy);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function renderSamplePageJpeg(spec: SamplePageSpec): Uint8Array {
  const width = 840;
  const height = 1188;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Paper background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Subtle top bar
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(56, 54, width - 112, 46);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(56, 54, width - 112, 46);

  ctx.fillStyle = '#2563eb';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(spec.chapter, 74, 83);

  ctx.fillStyle = '#64748b';
  ctx.font = '16px sans-serif';
  ctx.fillText(spec.section, 250, 83);

  ctx.textAlign = 'right';
  ctx.fillText(`P.${spec.pageNum}`, width - 74, 83);
  ctx.textAlign = 'left';

  // Problem Title
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(spec.title, 60, 160);

  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(60, 178);
  ctx.lineTo(width - 60, 178);
  ctx.stroke();

  // Body lines
  ctx.fillStyle = '#1e293b';
  ctx.font = '21px sans-serif';
  let curY = 230;
  for (const line of spec.body) {
    if (line === '') {
      curY += 18;
    } else {
      ctx.fillText(line, 64, curY);
      curY += 36;
    }
  }

  // Diagram box
  drawDiagram(ctx, spec.diagram, 64, curY + 24, width - 128, 220);

  // Workspace area for handwriting
  const noteY = curY + 270;
  const noteH = height - noteY - 88;
  ctx.strokeStyle = '#e2e8f0';
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(64, noteY, width - 128, noteH);
  ctx.setLineDash([]);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '15px sans-serif';
  ctx.fillText('解答・メモスペース（ペンで直接書き込めます）', 82, noteY + 28);

  // Footer
  ctx.fillStyle = '#94a3b8';
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`サンプル物理ワーク  - ${spec.pageNum} -`, width / 2, height - 38);
  ctx.textAlign = 'left';

  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  const base64 = dataUrl.split(',')[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function generateSamplePhysicsPdfBlob(): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0]; // index 0 unused (object 0)
  let bytePos = 0;

  const pushStr = (s: string) => {
    const b = encoder.encode(s);
    chunks.push(b);
    bytePos += b.length;
  };
  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    bytePos += b.length;
  };

  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  const pageCount = SAMPLE_PAGES.length;
  // Object layout:
  // 1: Catalog
  // 2: Pages
  // For each page i (0..pageCount-1):
  //   3 + i*3: Page object
  //   4 + i*3: Content stream
  //   5 + i*3: Image XObject

  const pageObjIds = SAMPLE_PAGES.map((_, i) => 3 + i * 3);

  // Obj 1: Catalog
  offsets[1] = bytePos;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  offsets[2] = bytePos;
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`,
  );

  for (let i = 0; i < pageCount; i++) {
    const pageObjId = 3 + i * 3;
    const contentObjId = 4 + i * 3;
    const imgObjId = 5 + i * 3;
    const jpegBytes = renderSamplePageJpeg(SAMPLE_PAGES[i]);

    // Page object (A4 points: 595 x 842)
    offsets[pageObjId] = bytePos;
    pushStr(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imgObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`,
    );

    // Content stream
    const streamStr = 'q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\n';
    const streamBytes = encoder.encode(streamStr);
    offsets[contentObjId] = bytePos;
    pushStr(`${contentObjId} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
    pushBytes(streamBytes);
    pushStr('endstream\nendobj\n');

    // Image XObject
    offsets[imgObjId] = bytePos;
    pushStr(
      `${imgObjId} 0 obj\n<< /Type /XObject /Subtype /Image /Width 840 /Height 1188 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
    );
    pushBytes(jpegBytes);
    pushStr('\nendstream\nendobj\n');
  }

  const xrefOffset = bytePos;
  const totalObjects = 2 + pageCount * 3 + 1;
  pushStr(`xref\n0 ${totalObjects}\n`);
  pushStr('0000000000 65535 f \n');
  for (let id = 1; id < totalObjects; id++) {
    const off = String(offsets[id]).padStart(10, '0');
    pushStr(`${off} 00000 n \n`);
  }
  pushStr(
    `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  const bytes = concatChunks(chunks);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

export const SAMPLE_IMPORT_CSV = `path,problemNumber,page,answer,hints
力学/運動の法則/基本例題,例題12,1,"(1) N = mg cosθ  (2) a = g sinθ","重力を斜面に平行と垂直に分解する"
力学/運動の法則/基本問題,問42,2,"(1) a = 3.0 m/s²  (2) f = 9.0 N","まずAとBを一体の物体とみなす|次にBだけに着目して運動方程式を立てる"
力学/摩擦力/基本問題,問43,3,"(1) a = g(sin30° + μ′cos30°)  (2) L = v₀² / 2a","動摩擦力は運動と逆向き（斜面下向き）|v² - v₀² = 2ax を使う"
力学/摩擦力/基本問題,問44,4,"F₀ = μ(M + m)g","すべり出す直前は2物体が同じ加速度|静止摩擦力が最大値 μmg に達した瞬間"
力学/仕事とエネルギー/発展例題,発展例題5,5,"x = kd² / (2μ′mg)","はじめの弾性エネルギー ＝ 動摩擦力がした仕事の大きさ"
力学/仕事とエネルギー/発展問題,問51,6,"(1) v = √{2gr(1 - cosθ)}  (2) cosθ = 2/3","面から離れる条件は 垂直抗力 N = 0|エネルギー保存則と円運動の運動方程式を連立"`;
