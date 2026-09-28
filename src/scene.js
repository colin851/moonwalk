import * as THREE from 'three';

// 将区间 [a, b] 内的进度映射为平滑的 0～1，区间外保持端点值。
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * 三维流程：渲染器 → 加载贴图 → 远景月球 → 近景月面 → 合成转场 → 动画循环。
 * App.vue 只通过返回的 setProgress / setSun / setWireframe / dispose 控制场景。
 * onReady 通知首帧已渲染；onError 通知贴图失败，贴图缺失时仍继续创建场景。
 */
export async function createMoonScene(canvas, onReady, onError) {
  // 1. 创建渲染器，限制像素比以控制高分屏上的绘制开销。
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x050609);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // 2. 远景场景：从太空观察完整月球，使用独立相机与光源。
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.02, 2000);
  camera.position.set(0, 0, 8);

  // 并行加载三张本地贴图；颜色图使用 sRGB，高程图保留数据纹理语义。
  const loader = new THREE.TextureLoader();
  const load = async (path, color = false) => {
    try {
      const t = await loader.loadAsync(`${import.meta.env.BASE_URL}textures/${path}`);
      if (color) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return t;
    } catch (e) {
      onError('部分影像未能加载，请重新加载以恢复完整月球纹理。');
      return null;
    }
  };
  const [map, bump, earthMap] = await Promise.all([
    load('moon.jpg', true),
    load('elevation.jpg'),
    load('earth.jpg', true),
  ]);
  const moonMat = new THREE.MeshStandardMaterial({
    map,
    bumpMap: bump,
    bumpScale: 0.022,
    roughness: 1,
    metalness: 0,
    color: 0xe9e8e6,
  });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1.8, 192, 128), moonMat);
  moon.rotation.set(0.08, -1.38, 0.12);
  world.add(moon);
  const sunlight = new THREE.DirectionalLight(0xfff4e7, 3.4);
  sunlight.position.set(-5, 2.5, 2.4);
  world.add(sunlight);
  world.add(new THREE.AmbientLight(0x8fa3bd, 0.035));
  // 固定随机种子使星空、环形山和岩石在每次刷新后保持一致；生成顺序也会影响结果。
  let seed = 91273;
  function rand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  const starPoints = [],
    starColors = [];
  for (let i = 0; i < 2200; i++) {
    const z = rand() * 2 - 1,
      a = rand() * Math.PI * 2,
      r = 600;
    const s = Math.sqrt(1 - z * z);
    starPoints.push(s * Math.cos(a) * r, z * r, s * Math.sin(a) * r);
    const b = 0.22 + rand() * 0.48;
    starColors.push(b * 0.88, b * 0.93, b);
  }
  const starsGeometry = new THREE.BufferGeometry();
  starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPoints, 3));
  starsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
  const stars = new THREE.Points(
    starsGeometry,
    new THREE.PointsMaterial({
      size: 0.52,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
    }),
  );
  world.add(stars);

  // 3. 近景场景：单独构建月面、阴影和地球，通过合成器与远景交叉淡入淡出。
  const surface = new THREE.Scene();
  surface.background = new THREE.Color(0x030508);
  surface.fog = new THREE.FogExp2(0x090c11, 0.0017);
  const surfaceCam = new THREE.PerspectiveCamera(49, innerWidth / innerHeight, 0.1, 1600);
  const surfaceStars = stars.clone();
  surfaceStars.material = stars.material.clone();
  surfaceStars.material.opacity = 0.6;
  surface.add(surfaceStars);
  const surfaceSun = new THREE.DirectionalLight(0xffefd9, 2.1);
  surfaceSun.position.set(-90, 55, 10);
  surfaceSun.castShadow = true;
  surfaceSun.shadow.mapSize.set(2048, 2048);
  Object.assign(surfaceSun.shadow.camera, {
    left: -85,
    right: 85,
    top: 85,
    bottom: -85,
    near: 1,
    far: 260,
  });
  surfaceSun.shadow.bias = -0.0004;
  surfaceSun.shadow.normalBias = 0.15;
  surfaceSun.target.position.set(0, 0, 10);
  surface.add(surfaceSun.target);
  surface.add(surfaceSun);
  surface.add(new THREE.HemisphereLight(0x819ab8, 0x14110e, 0.19));
  // 程序化月面是艺术化模拟，不是实测高程重建；r 表示坑半径，d 控制起伏幅度。
  const craters = Array.from({ length: 58 }, () => ({
    x: (rand() - 0.5) * 650,
    z: (rand() - 0.5) * 650,
    r: 6 + rand() * 30,
    d: 0.9 + rand() * 3,
  }));
  // 同一高度函数用于地形顶点、岩石落点与相机离地高度，确保三者相互贴合。
  function height(x, z) {
    let h =
      4.5 * Math.sin(x * 0.018 + Math.sin(z * 0.013) * 1.4) +
      2.7 * Math.cos(z * 0.029 + x * 0.009) +
      0.65 * Math.sin(x * 0.095 + z * 0.055) +
      0.22 * Math.cos(x * 0.3 - z * 0.28) +
      0.065 * Math.sin(x * 1.3 + z * 0.9);
    // 在多尺度波形上叠加环形山：坑缘隆起，中心下凹。
    for (const c of craters) {
      let q = Math.hypot(x - c.x, z - c.z) / c.r;
      if (q < 1.6)
        h += c.d * (1.0 * Math.exp(-Math.pow((q - 1) * 7, 2)) - 1.6 * Math.exp(-q * q * 3));
    }
    return h;
  }

  // 水平网格逐点设置高度与颜色，重算法线后让光照体现地形起伏。
  const terrainGeo = new THREE.PlaneGeometry(850, 850, 420, 420);
  terrainGeo.rotateX(-Math.PI / 2);
  const pos = terrainGeo.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      z = pos.getZ(i);
    const h = height(x, z);
    pos.setY(i, h);
    const c = 0.43 + rand() * 0.13 + h * 0.007;
    colors.push(c * 1.025, c, c * 0.98);
  }
  terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();

  // 生成可重复铺设的颗粒凹凸纹理，补充近距离的月壤细节。
  const detailCanvas = document.createElement('canvas');
  detailCanvas.width = 512;
  detailCanvas.height = 512;
  const ctx = detailCanvas.getContext('2d');
  const pixels = ctx.createImageData(512, 512);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const v = 90 + rand() * 110;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const grit = new THREE.CanvasTexture(detailCanvas);
  grit.wrapS = grit.wrapT = THREE.RepeatWrapping;
  grit.repeat.set(190, 190);
  grit.anisotropy = 8;
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    bumpMap: grit,
    bumpScale: 0.1,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  surface.add(terrain);

  // 在标准材质着色器中加入位置噪声，叠加不同尺度的尘土明暗。
  terrainMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 terrainPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nterrainPosition=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
        #include <common>
        varying vec3 terrainPosition;
        float hash3(vec3 p){
          p=fract(p*.3183099+.1);
          p*=17.;
          return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
        }
        float terrainNoise(vec3 p){
          vec3 i=floor(p),f=fract(p);
          f=f*f*(3.-2.*f);
          // 对网格八个角的噪声做三线性插值，得到连续的月壤纹理。
          return mix(
            mix(
              mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
              mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x),
              f.y
            ),
            mix(
              mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
              mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x),
              f.y
            ),
            f.z
          );
        }
      `,
      )
      .replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        float dust=terrainNoise(terrainPosition*2.)*.42+terrainNoise(terrainPosition*9.)*.32+terrainNoise(terrainPosition*35.)*.16;
        diffuseColor.rgb*=.40+dust*.85;
      `,
      );
  };

  // 1600 块岩石共用几何体与材质，通过实例矩阵改变位置、旋转和大小。
  const rockGeo = new THREE.IcosahedronGeometry(1, 2);
  const rp = rockGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const f = 0.82 + 0.18 * Math.sin(rp.getX(i) * 9 + rp.getY(i) * 4 + rp.getZ(i) * 8);
    rp.setXYZ(i, rp.getX(i) * f, rp.getY(i) * f, rp.getZ(i) * f);
  }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x7c7a76,
    roughness: 1,
    flatShading: true,
    bumpMap: grit,
    bumpScale: 0.08,
  });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 1600);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 1600; i++) {
    let x = (rand() - 0.5) * 330,
      z = (rand() - 0.5) * 330;
    let scale = 0.13 + Math.pow(rand(), 4) * 2.6;
    dummy.position.set(x, height(x, z) + scale * 0.25, z);
    dummy.rotation.set(rand(), rand() * 6, rand());
    dummy.scale.set(scale, scale * 0.6, scale * 0.83);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  surface.add(rocks);

  // 地球与边缘大气光晕用于最终回望构图，位置与比例采用艺术化设定。
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(9.5, 64, 48),
    new THREE.MeshStandardMaterial({
      map: earthMap,
      emissiveMap: earthMap,
      emissive: 0xffffff,
      emissiveIntensity: 0.24,
      roughness: 0.95,
    }),
  );
  earth.position.set(51, 57, -250);
  earth.rotation.set(0.17, 3.8, 0.22);
  surface.add(earth);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(9.8, 64, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 n;
        varying vec3 v;
        void main(){
          vec4 p=modelViewMatrix*vec4(position,1.0);
          n=normalize(normalMatrix*normal);
          v=normalize(-p.xyz);
          gl_Position=projectionMatrix*p;
        }
      `,
      fragmentShader: `
        varying vec3 n;
        varying vec3 v;
        void main(){
          float rim=pow(1.0-max(dot(n,v),0.0),4.0);
          gl_FragColor=vec4(.18,.45,.88,rim*.65);
        }
      `,
    }),
  );
  earth.add(atmosphere);

  // 4. 两个离屏目标分别保存远景和近景，最后用全屏平面按 blend 混合。
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const targetA = new THREE.WebGLRenderTarget(size.x, size.y);
  const targetB = new THREE.WebGLRenderTarget(size.x, size.y);
  const compositor = new THREE.Scene();
  const compCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    a: { value: targetA.texture },
    b: { value: targetB.texture },
    blend: { value: 0 },
  };
  const composite = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: `
        varying vec2 uvv;
        void main(){
          uvv=uv;
          gl_Position=vec4(position.xy,0.,1.);
        }
      `,
      fragmentShader: `
        uniform sampler2D a;
        uniform sampler2D b;
        uniform float blend;
        varying vec2 uvv;
        void main(){
          gl_FragColor=mix(texture2D(a,uvv),texture2D(b,uvv),blend);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  compositor.add(composite);

  // target 是页面传入的目标进度，p 是逐帧平滑后的实际镜头进度。
  let target = 0,
    p = 0,
    frame = 0,
    disposed = false,
    last = performance.now(),
    pointerX = 0,
    pointerY = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 窗口变化时同步两套相机和离屏纹理尺寸，避免画面拉伸。
  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = surfaceCam.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    surfaceCam.updateProjectionMatrix();
    renderer.getDrawingBufferSize(size);
    targetA.setSize(size.x, size.y);
    targetB.setSize(size.x, size.y);
  }

  // 指针坐标归一化到中心附近，用于近景相机的小幅视差。
  function pointer(e) {
    pointerX = e.clientX / innerWidth - 0.5;
    pointerY = e.clientY / innerHeight - 0.5;
  }
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', pointer, { passive: true });

  // 5. 每帧：平滑进度 → 更新远景镜头 → 更新近景镜头 → 绘制并合成。
  function draw(now) {
    if (disposed) return;
    frame = requestAnimationFrame(draw);
    if (document.hidden) return;
    // 限制时间步长，避免切回标签页时镜头突然大幅跳动。
    let dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    p = reduce ? target : THREE.MathUtils.lerp(p, target, 1 - Math.exp(-dt * 8));
    const mobile = innerWidth < 800;
    // 5%～64% 推近月球；49%～67% 将远景交叉溶解为月面近景。
    const approach = smooth(0.05, 0.64, p);
    const blend = smooth(0.49, 0.67, p);
    uniforms.blend.value = blend;
    camera.position.set(0, 0, THREE.MathUtils.lerp(mobile ? 10.3 : 8, 2.05, approach));
    camera.lookAt(0, 0, 0);
    moon.position.set(
      THREE.MathUtils.lerp(mobile ? 0.72 : 1.13, 0, approach),
      THREE.MathUtils.lerp(mobile ? -0.6 : 0.1, -0.3, approach),
      0,
    );
    moon.rotation.y = -1.38 + p * 0.48;
    moon.rotation.z = 0.12 - p * 0.12;
    // 后半程沿月面下降，相机始终以 height(x, z) 为离地高度基准。
    const descent = smooth(0.5, 1, p);
    const z = THREE.MathUtils.lerp(115, 28, descent);
    const x = THREE.MathUtils.lerp(16, 0, descent);
    surfaceCam.position.set(x, height(x, z) + THREE.MathUtils.lerp(38, 1.8, descent), z);
    surfaceCam.lookAt(
      x + (!reduce ? pointerX * 2 : 0),
      THREE.MathUtils.lerp(-16, 10, descent) + (!reduce ? pointerY * 0.6 : 0),
      -180,
    );
    earth.position.x = mobile ? 39 : 51;
    // 混合端点跳过完全不可见的场景，最后回到屏幕输出合成结果。
    renderer.setRenderTarget(targetA);
    if (blend < 1) renderer.render(world, camera);
    renderer.setRenderTarget(targetB);
    if (blend > 0) renderer.render(surface, surfaceCam);
    renderer.setRenderTarget(null);
    renderer.render(compositor, compCam);
  }
  // 两个场景先在线性空间渲染，合成输出时统一执行色调映射与色彩空间转换。
  draw(performance.now());
  onReady();

  // 对外接口：页面不用直接访问 Three.js 内部对象。
  return {
    // 更新目标，实际镜头在 draw 中逐帧追随。
    setProgress(value) {
      target = value;
    },
    // 将角度转换为光源高度，同时更新远景与近景的太阳。
    setSun(degrees) {
      const r = (degrees * Math.PI) / 180;
      surfaceSun.position.set(-90, Math.tan(r) * 90, 10);
      sunlight.position.set(-5, Math.tan(r) * 4, 2.4);
    },
    // 线框模式隐藏岩石，让地形网格更容易辨认。
    setWireframe(value) {
      terrainMat.wireframe = value;
      moonMat.wireframe = value;
      rocks.visible = !value;
    },
    // 停止循环和监听，释放几何体、材质、纹理、离屏目标与渲染器。
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', pointer);
      const disposedItems = new Set();
      [world, surface, compositor].forEach((s) =>
        s.traverse((o) => {
          o.geometry?.dispose();
          for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
            if (mat && !disposedItems.has(mat)) {
              disposedItems.add(mat);
              mat.dispose();
            }
          }
        }),
      );
      [map, bump, earthMap, grit].forEach((t) => t?.dispose());
      targetA.dispose();
      targetB.dispose();
      renderer.dispose();
    },
  };
}
