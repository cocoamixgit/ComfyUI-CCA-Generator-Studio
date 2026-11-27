// 3D の結果(GLB)を表示する。three.js(MIT。web/lib/three)は初めて使うときに読み込む
// 操作: ドラッグで回転・ホイールで拡大縮小・右ドラッグで移動
const LIB = new URL("./lib/three/", import.meta.url).href;
let libs = null;
function loadLibs() {
  libs ||= Promise.all([import(`${LIB}three.module.min.mjs`), import(`${LIB}GLTFLoader.mjs`), import(`${LIB}OrbitControls.mjs`)])
    .then(([THREE, g, o]) => ({ THREE, GLTFLoader: g.GLTFLoader, OrbitControls: o.OrbitControls }))
    .catch((e) => { libs = null; throw e; });
  return libs;
}

function disposeAll(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}

// 周囲の光(環境マップ)を作る。金属の面は、周りの光が無いと真っ黒になるため(ライトだけでは足りない)
function makeEnv(THREE, renderer) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x8f959e, side: THREE.BackSide })));
  const panel = (i, x, y, z, w, h) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.material.color.setScalar(i);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(4, 0, 4.9, 0, 6, 6);
  panel(6, 4, 2, 3, 3, 3);
  panel(3, -4, 1, -3, 3, 3);
  panel(2, 0, 1, 4.9, 6, 3);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  s.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  return rt;
}

// box の中に url の 3D モデルを出す。戻り値の destroy() で片付ける
export function view3d(box, url, { onError } = {}) {
  let alive = true, stop = () => {};
  loadLibs().then(({ THREE, GLTFLoader, OrbitControls }) => {
    if (!alive) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    box.append(renderer.domElement);
    const scene = new THREE.Scene();
    const env = makeEnv(THREE, renderer);
    scene.environment = env.texture;
    scene.environmentIntensity = 1.0;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f47, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key);
    const back = new THREE.DirectionalLight(0xffffff, 0.6);
    back.position.set(-4, 2, -3);
    scene.add(back);
    const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    const ctl = new OrbitControls(cam, renderer.domElement);
    ctl.enableDamping = true;
    const fit = () => {
      const w = Math.max(1, box.clientWidth), h = Math.max(1, box.clientHeight);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    fit();
    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); ctl.update(); renderer.render(scene, cam); };
    tick();
    let model = null;
    new GLTFLoader().load(url, (g) => {
      if (!alive) { disposeAll(g.scene); return; }
      model = g.scene;
      scene.add(model);
      // 真ん中に置き、全体が見える距離から斜め上を向く
      const b = new THREE.Box3().setFromObject(model);
      const c = b.getCenter(new THREE.Vector3());
      const r = b.getSize(new THREE.Vector3()).length() / 2 || 1;
      model.position.sub(c);
      cam.near = r / 100;
      cam.far = r * 100;
      cam.position.set(r * 1.4, r * 0.9, r * 2.3);
      cam.updateProjectionMatrix();
      ctl.target.set(0, 0, 0);
      ctl.update();
    }, undefined, (e) => { if (alive) onError?.(e); });
    stop = () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctl.dispose();
      if (model) disposeAll(model);
      env.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }).catch((e) => { if (alive) onError?.(e); });
  return { destroy() { alive = false; stop(); } };
}
