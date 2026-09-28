<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { createMoonScene } from './scene.js';

/**
 * 页面控制中心：挂载后创建三维场景，滚动时把 progress 同步给场景。
 * 同一份 progress 驱动章节高亮、示意距离和底部进度条；按钮调用场景公开方法。
 * 卸载时停止动画、音频并移除事件监听。
 */
const canvas = ref(null); // Three.js 使用的画布，由模板挂载后赋值。
const progress = ref(0); // 整段页面的滚动比例，范围为 0～1。
const ready = ref(false); // 场景完成初始化并执行首帧渲染。
const error = ref(''); // 纹理加载或 WebGL 初始化失败的提示。
const panel = ref(false); // 数据来源说明面板。
const wireframe = ref(false); // 地形与月球的线框显示开关。
const sun = ref(32); // 光照滑块的角度值，传给场景前转成数值。
const immersive = ref(false); // 隐藏文字与导航的纯净视野。
const sound = ref(false); // 合成氛围音开关。

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const stages = ['远望月球', '深入纹理', '掠过月面', '回望地球'];
// 按滚动区间划分当前章节；这里只表示旅程阶段，不是三维场景切换点。
const current = computed(() =>
  progress.value < 0.22 ? 0 : progress.value < 0.48 ? 1 : progress.value < 0.78 ? 2 : 3,
);
// 非线性递减的示意距离，用于视觉叙事，并非实际轨道或高度计算。
const altitude = computed(() =>
  (384400 * Math.pow(1 - progress.value, 5)).toLocaleString('zh-CN', {
    maximumFractionDigits: progress.value > 0.9 ? 2 : 0,
  }),
);
// 非响应式资源句柄：不参与模板渲染，由生命周期统一管理。
let scene,
  audio,
  gain,
  audioSources = [],
  returnFocus;

// 打开说明后锁定背景滚动并移入焦点，关闭后恢复原来的焦点。
watch(panel, async (open) => {
  if (open) {
    returnFocus = document.activeElement;
    await nextTick();
    document.querySelector('.close-button')?.focus();
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
    returnFocus?.focus();
  }
});

// 重新加载页面，让失败的纹理与 WebGL 初始化可以重试。
function reloadPage() {
  location.reload();
}

// 章节按钮只负责滚动；后续仍由 scroll → sync 驱动 UI 和镜头。
function go(index) {
  window.scrollTo({
    top: [0, 0.29, 0.61, 1][index] * (document.documentElement.scrollHeight - innerHeight),
    behavior: reduced ? 'instant' : 'smooth',
  });
}

// 把实际滚动位置归一化，并传给 scene.js 的动画目标进度。
function sync() {
  progress.value = Math.min(
    1,
    Math.max(0, scrollY / (document.documentElement.scrollHeight - innerHeight)),
  );
  scene?.setProgress(progress.value);
}

// 控件事件：将太阳角度与线框开关同步到三维场景。
function setSun() {
  scene?.setSun(Number(sun.value));
}
function toggleWire() {
  wireframe.value = !wireframe.value;
  scene?.setWireframe(wireframe.value);
}

// 用户首次点击时才创建音频：三个低频振荡器 → 各自音量 → 总音量 → 扬声器。
async function toggleSound() {
  if (!audio) {
    audio = new AudioContext();
    gain = audio.createGain();
    gain.gain.value = 0;
    gain.connect(audio.destination);
    [55, 82.4, 110.3].forEach((frequency, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = frequency;
      g.gain.value = 0.035 / (i + 1);
      o.connect(g);
      g.connect(gain);
      o.start();
      audioSources.push(o);
    });
  }
  await audio.resume();
  sound.value = !sound.value;
  // 平滑改变总音量，避免开关瞬间出现突兀的声音。
  gain.gain.setTargetAtTime(sound.value ? 0.7 : 0, audio.currentTime, 0.5);
}

// Tab 焦点在弹窗内循环；Esc 同时关闭说明与纯净视野。
function onKey(e) {
  if (panel.value && e.key === 'Tab') {
    const items = [...document.querySelectorAll('.source-panel button,.source-panel a')];
    const first = items[0],
      last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  if (e.key === 'Escape') {
    panel.value = false;
    immersive.value = false;
  }
}

// 启动顺序：监听事件 → 读取滚动位置 → 异步创建场景 → 再同步最新进度。
onMounted(async () => {
  window.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('keydown', onKey);
  sync();
  try {
    scene = await createMoonScene(
      canvas.value,
      () => {
        ready.value = true;
      },
      (message) => {
        error.value = message;
      },
    );
    // 纹理加载期间用户可能已经滚动，需要补上最新位置。
    sync();
  } catch (e) {
    error.value = '当前设备无法开启三维画面，请使用支持 WebGL 的浏览器重新打开。';
  }
});

// 页面退出时回收 GPU 与音频资源，停止持续运行的回调。
onBeforeUnmount(() => {
  window.removeEventListener('scroll', sync);
  window.removeEventListener('keydown', onKey);
  scene?.dispose();
  audioSources.forEach((o) => o.stop());
  audio?.close();
});
</script>
<template>
  <div class="experience" :class="{ immersive }">
    <!-- 固定背景层：三维画布与提升文字可读性的遮罩。 -->
    <canvas ref="canvas" aria-label="可随滚动探索的三维月球与月面" />
    <div class="shade" aria-hidden="true"></div>
    <!-- 导航层：跳转章节、显示当前位置、打开来源说明。 -->
    <header class="header">
      <a href="#" class="brand" @click.prevent="go(0)" aria-label="月之彼端，返回起点"
        ><svg viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="11" stroke="currentColor" />
          <path d="M20 5c-12 1-15 17-4 22M4 24 28 8" stroke="currentColor" /></svg
        ><span>月之彼端</span></a
      >
      <nav aria-label="旅程章节">
        <button
          v-for="(stage, i) in stages"
          :key="stage"
          :class="{ active: current === i }"
          :aria-current="current === i ? 'step' : undefined"
          @click="go(i)"
        >
          {{ stage }}
        </button>
      </nav>
      <button class="source-link" @click="panel = true">关于这次探索 <span>↗</span></button>
    </header>
    <!-- 四个章节撑起滚动长度；章节内 sticky 文案停留，背景镜头持续推进。 -->
    <main>
      <section class="chapter hero" aria-label="远望月球">
        <div class="hero-copy">
          <h1>远不止<br />一轮月。</h1>
          <p class="intro">把三十八万公里的遥望，<br />变成一次触手可及的抵达。</p>
          <button class="journey-button" @click="go(1)">
            <span>向月球出发</span
            ><svg viewBox="0 0 24 24" fill="none">
              <path d="M12 4v15m-5-5 5 5 5-5" stroke="currentColor" stroke-width="1.3" />
            </svg>
          </button>
          <div class="hero-credit">
            <span class="tiny-orbit"></span>来自 NASA 公开月球影像<span class="credit-line"></span
            >为好奇心而作
          </div>
        </div>
        <div class="moon-caption">
          <span class="crosshair"></span>
          <div>月球近侧<span>一颗星球，亿万年的痕迹</span></div>
        </div>
        <div class="scroll-note"><span class="scroll-track"></span>向下滚动，慢慢靠近</div>
        <div class="edition">地月之间<br /><span>一场 384,400 公里的旅程</span></div>
      </section>
      <section class="chapter detail" aria-label="深入纹理">
        <div class="story-copy">
          <span class="chapter-marker">第一段航程 / 深入纹理</span>
          <h2>每一道伤痕，<br />都有亿万年。</h2>
          <p>超过十万张轨道影像，拼成一张月球肖像。<br />明暗交界处，环形山的边缘开始显现。</p>
          <div class="data-line">
            <strong>100,000<span>+</span></strong
            ><span>广角相机影像参与拼接</span>
          </div>
          <p class="fine-print">
            当前展示 NASA 全球颜色贴图；原始窄角相机影像<br />在许多区域可达到每像素一米或更优。
          </p>
          <a
            href="https://quickmap.lroc.asu.edu/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-link"
            >到原始影像中继续放大 <span>↗</span></a
          >
        </div>
      </section>
      <!-- 月面交互：太阳滑块和线框按钮调用上方场景控制方法。 -->
      <section class="chapter descent" aria-label="掠过月面">
        <div class="story-copy">
          <span class="chapter-marker">第二段航程 / 下降</span>
          <h2>让光，<br />刻出月的形状。</h2>
          <p>没有空气柔化边界。<br />一束斜阳，就让山脊与深坑显形。</p>
          <div class="lighting-control">
            <label for="sun"
              >移动太阳，看看阴影如何变化 <span>{{ sun }}°</span></label
            ><input id="sun" type="range" min="8" max="75" v-model="sun" @input="setSun" />
            <div class="range-labels"><span>掠地长影</span><span>高处日光</span></div>
          </div>
          <button class="outline-button" @click="toggleWire" :aria-pressed="wireframe">
            {{ wireframe ? '返回月面材质' : '查看地形骨架'
            }}<svg viewBox="0 0 20 20" fill="none">
              <path d="m3 14 7-10 7 10H3Zm0 0 7-3 7 3M10 4v7" stroke="currentColor" />
            </svg>
          </button>
          <p class="fine-print">近景为程序化地形演绎，非具体着陆点实测重建。</p>
        </div>
      </section>
      <section class="chapter arrival" aria-label="回望地球">
        <div class="arrival-copy">
          <span class="chapter-marker">最后一段航程 / 抵达</span>
          <h2>走得足够远，<br />才看清家的模样。</h2>
          <p>这里没有风，也没有浪。<br />月平线之上，那一点蓝，装着我们的一切。</p>
          <button class="journey-button" @click="immersive = !immersive">
            <span>安静看一会儿</span
            ><svg viewBox="0 0 24 24" fill="none">
              <path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5" stroke="currentColor" />
            </svg></button
          ><button class="restart" @click="go(0)">重新启程</button>
        </div>
        <p class="surface-note">月面与地球位置为艺术化构图 · 愿你的好奇心，永不落地。</p>
      </section>
    </main>
    <!-- 常驻状态栏：展示与场景共用的进度，并提供音频开关。 -->
    <footer class="flight-bar">
      <div class="flight-status">
        <span class="status-dot"></span><span>{{ stages[current] }}</span
        ><span class="status-divider"></span
        ><span class="altitude"
          >旅程示意距离 <b>{{ altitude }}</b> 公里</span
        >
      </div>
      <div class="flight-progress">
        <span>地球</span>
        <div><i :style="{ width: `${progress * 100}%` }"></i></div>
        <span>月面</span>
      </div>
      <button class="sound-button" @click="toggleSound" :aria-pressed="sound">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M5 10v4m4-7v10m4-13v16m4-13v10m4-7v4"
            stroke="currentColor"
            stroke-width="1.3"
          /></svg
        >{{ sound ? '氛围音开' : '氛围音关' }}
      </button>
    </footer>
    <!-- 状态反馈：加载中、失败重试与纯净视野退出入口。 -->
    <div v-if="!ready && !error" class="loading" role="status">
      <span class="status-dot"></span>正在接收月球影像…
    </div>
    <div v-if="error" class="error" role="alert">
      {{ error }} <button @click="reloadPage">重新加载</button>
    </div>
    <button v-if="immersive" class="exit-immersive outline-button" @click="immersive = false">
      退出纯净视野
    </button>
    <!-- 来源说明弹窗：点击遮罩关闭，键盘焦点由 watch(panel) / onKey 管理。 -->
    <div v-if="panel" class="panel-backdrop" @click.self="panel = false">
      <section class="source-panel" role="dialog" aria-modal="true" aria-labelledby="source-title">
        <button class="close-button" autofocus @click="panel = false" aria-label="关闭说明">
          ×
        </button>
        <h2 id="source-title">真实的月球。<br />自由的想象。</h2>
        <p>这是一段由公开科学影像启发的视觉旅程，并非科学测绘工具。</p>
        <dl>
          <dt>月球颜色与高程</dt>
          <dd>
            NASA 科学可视化工作室「CGI Moon Kit」，源于 LRO 的 LROC 广角相机与 LOLA
            激光测高仪。颜色图于 2025 年重新处理，页面于 2026 年更新。
          </dd>
          <dt>你眼前的分辨率</dt>
          <dd>
            浏览器使用 4096 × 2048 的全球颜色纹理，由 NASA 官方 16 位 TIFF
            转换压缩。原始科学数据与网页纹理的精度不同；一米级描述指 LROC
            窄角影像，并不代表此处每一帧的精度。
          </dd>
          <dt>近景与声音</dt>
          <dd>
            月面近景、岩石、地球位置与航程距离为艺术化模拟。氛围音是合成配乐；真空中没有可传播的环境声。
          </dd>
          <dt>关于 IBM</dt>
          <dd>尚未核实 IBM 与这套月球数据的合作关系，本作品不作相关合作声明。</dd>
        </dl>
        <a
          class="text-link"
          href="https://svs.gsfc.nasa.gov/4720/"
          target="_blank"
          rel="noopener noreferrer"
          >查看 NASA 原始数据与署名 ↗</a
        >
        <p class="fine-print">
          影像：NASA / GSFC / Arizona State University<br />地球纹理：Three.js 示例资源
        </p>
      </section>
    </div>
  </div>
</template>
