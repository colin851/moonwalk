<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { createMoonScene } from './scene.js';
const canvas = ref(null), progress = ref(0), ready = ref(false), error = ref(''), panel = ref(false), wireframe = ref(false), sun = ref(32), immersive = ref(false), sound = ref(false);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const stages = ['远望月球', '深入纹理', '掠过月面', '回望地球'];
const current = computed(() => progress.value < .22 ? 0 : progress.value < .48 ? 1 : progress.value < .78 ? 2 : 3);
const altitude = computed(() => (384400 * Math.pow(1-progress.value, 5)).toLocaleString('zh-CN',{ maximumFractionDigits: progress.value > .9 ? 2 : 0 }));
let scene, audio, gain, audioSources = [], returnFocus;
watch(panel, async open => { if(open) { returnFocus=document.activeElement; await nextTick();document.querySelector('.close-button')?.focus();document.body.style.overflow='hidden'; } else {document.body.style.overflow='';returnFocus?.focus();} });
function reloadPage(){ location.reload(); }
function go(index) { window.scrollTo({ top: [0,.29,.61,1][index] * (document.documentElement.scrollHeight-innerHeight), behavior: reduced ? 'instant' : 'smooth' }); }
function sync() { progress.value = Math.min(1, Math.max(0, scrollY / (document.documentElement.scrollHeight-innerHeight))); scene?.setProgress(progress.value); }
function setSun() { scene?.setSun(Number(sun.value)); }
function toggleWire() { wireframe.value = !wireframe.value; scene?.setWireframe(wireframe.value); }
async function toggleSound() {
 if (!audio) { audio = new AudioContext(); gain = audio.createGain(); gain.gain.value = 0; gain.connect(audio.destination); [55,82.4,110.3].forEach((frequency,i)=>{ const o=audio.createOscillator(); const g=audio.createGain(); o.frequency.value=frequency; g.gain.value=.035/(i+1); o.connect(g);g.connect(gain);o.start();audioSources.push(o); }); }
 await audio.resume(); sound.value = !sound.value; gain.gain.setTargetAtTime(sound.value ? .7 : 0,audio.currentTime,.5);
}
function onKey(e) { if(panel.value && e.key==='Tab'){ const items=[...document.querySelectorAll('.source-panel button,.source-panel a')];const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();} } if(e.key==='Escape') { panel.value=false;immersive.value=false; } }
onMounted(async()=>{ window.addEventListener('scroll',sync,{passive:true});window.addEventListener('keydown',onKey); sync(); try { scene=await createMoonScene(canvas.value,()=>{ready.value=true},message=>{error.value=message});sync(); } catch(e) { error.value='当前设备无法开启三维画面，请使用支持 WebGL 的浏览器重新打开。'; } });
onBeforeUnmount(()=>{ window.removeEventListener('scroll',sync);window.removeEventListener('keydown',onKey);scene?.dispose();audioSources.forEach(o=>o.stop());audio?.close(); });
</script>
<template>
 <div class="experience" :class="{ immersive }">
  <canvas ref="canvas" aria-label="可随滚动探索的三维月球与月面" />
  <div class="shade" aria-hidden="true"></div>
  <header class="header">
   <a href="#" class="brand" @click.prevent="go(0)" aria-label="月之彼端，返回起点"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="11" stroke="currentColor"/><path d="M20 5c-12 1-15 17-4 22M4 24 28 8" stroke="currentColor"/></svg><span>月之彼端</span></a>
   <nav aria-label="旅程章节"><button v-for="(stage,i) in stages" :key="stage" :class="{active:current===i}" :aria-current="current===i ? 'step':undefined" @click="go(i)">{{ stage }}</button></nav>
   <button class="source-link" @click="panel=true">关于这次探索 <span>↗</span></button>
  </header>
  <main>
   <section class="chapter hero" aria-label="远望月球">
    <div class="hero-copy">
     <h1>远不止<br>一轮月。</h1>
     <p class="intro">把三十八万公里的遥望，<br>变成一次触手可及的抵达。</p>
     <button class="journey-button" @click="go(1)"><span>向月球出发</span><svg viewBox="0 0 24 24" fill="none"><path d="M12 4v15m-5-5 5 5 5-5" stroke="currentColor" stroke-width="1.3"/></svg></button>
     <div class="hero-credit"><span class="tiny-orbit"></span>来自 NASA 公开月球影像<span class="credit-line"></span>为好奇心而作</div>
    </div>
    <div class="moon-caption"><span class="crosshair"></span><div>月球近侧<span>一颗星球，亿万年的痕迹</span></div></div>
    <div class="scroll-note"><span class="scroll-track"></span>向下滚动，慢慢靠近</div>
    <div class="edition">地月之间<br><span>一场 384,400 公里的旅程</span></div>
   </section>
   <section class="chapter detail" aria-label="深入纹理"><div class="story-copy"><span class="chapter-marker">第一段航程 / 深入纹理</span><h2>每一道伤痕，<br>都有亿万年。</h2><p>超过十万张轨道影像，拼成一张月球肖像。<br>明暗交界处，环形山的边缘开始显现。</p><div class="data-line"><strong>100,000<span>+</span></strong><span>广角相机影像参与拼接</span></div><p class="fine-print">当前展示 NASA 全球颜色贴图；原始窄角相机影像<br>在许多区域可达到每像素一米或更优。</p><a href="https://quickmap.lroc.asu.edu/" target="_blank" rel="noopener noreferrer" class="text-link">到原始影像中继续放大 <span>↗</span></a></div></section>
   <section class="chapter descent" aria-label="掠过月面"><div class="story-copy"><span class="chapter-marker">第二段航程 / 下降</span><h2>让光，<br>刻出月的形状。</h2><p>没有空气柔化边界。<br>一束斜阳，就让山脊与深坑显形。</p><div class="lighting-control"><label for="sun">移动太阳，看看阴影如何变化 <span>{{ sun }}°</span></label><input id="sun" type="range" min="8" max="75" v-model="sun" @input="setSun"/><div class="range-labels"><span>掠地长影</span><span>高处日光</span></div></div><button class="outline-button" @click="toggleWire" :aria-pressed="wireframe">{{ wireframe ? '返回月面材质' : '查看地形骨架' }}<svg viewBox="0 0 20 20" fill="none"><path d="m3 14 7-10 7 10H3Zm0 0 7-3 7 3M10 4v7" stroke="currentColor"/></svg></button><p class="fine-print">近景为程序化地形演绎，非具体着陆点实测重建。</p></div></section>
   <section class="chapter arrival" aria-label="回望地球"><div class="arrival-copy"><span class="chapter-marker">最后一段航程 / 抵达</span><h2>走得足够远，<br>才看清家的模样。</h2><p>这里没有风，也没有浪。<br>月平线之上，那一点蓝，装着我们的一切。</p><button class="journey-button" @click="immersive=!immersive"><span>安静看一会儿</span><svg viewBox="0 0 24 24" fill="none"><path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5" stroke="currentColor"/></svg></button><button class="restart" @click="go(0)">重新启程</button></div><p class="surface-note">月面与地球位置为艺术化构图 · 愿你的好奇心，永不落地。</p></section>
  </main>
  <footer class="flight-bar"><div class="flight-status"><span class="status-dot"></span><span>{{ stages[current] }}</span><span class="status-divider"></span><span class="altitude">旅程示意距离 <b>{{ altitude }}</b> 公里</span></div><div class="flight-progress"><span>地球</span><div><i :style="{width:`${progress*100}%`}"></i></div><span>月面</span></div><button class="sound-button" @click="toggleSound" :aria-pressed="sound"><svg viewBox="0 0 24 24" fill="none"><path d="M5 10v4m4-7v10m4-13v16m4-13v10m4-7v4" stroke="currentColor" stroke-width="1.3"/></svg>{{ sound ? '氛围音开' : '氛围音关' }}</button></footer>
  <div v-if="!ready&&!error" class="loading" role="status"><span class="status-dot"></span>正在接收月球影像…</div>
  <div v-if="error" class="error" role="alert">{{error}} <button @click="reloadPage">重新加载</button></div>
  <button v-if="immersive" class="exit-immersive outline-button" @click="immersive=false">退出纯净视野</button>
  <div v-if="panel" class="panel-backdrop" @click.self="panel=false"><section class="source-panel" role="dialog" aria-modal="true" aria-labelledby="source-title"><button class="close-button" autofocus @click="panel=false" aria-label="关闭说明">×</button><h2 id="source-title">真实的月球。<br>自由的想象。</h2><p>这是一段由公开科学影像启发的视觉旅程，并非科学测绘工具。</p><dl><dt>月球颜色与高程</dt><dd>NASA 科学可视化工作室「CGI Moon Kit」，源于 LRO 的 LROC 广角相机与 LOLA 激光测高仪。颜色图于 2025 年重新处理，页面于 2026 年更新。</dd><dt>你眼前的分辨率</dt><dd>浏览器使用 4096 × 2048 的全球颜色纹理，由 NASA 官方 16 位 TIFF 转换压缩。原始科学数据与网页纹理的精度不同；一米级描述指 LROC 窄角影像，并不代表此处每一帧的精度。</dd><dt>近景与声音</dt><dd>月面近景、岩石、地球位置与航程距离为艺术化模拟。氛围音是合成配乐；真空中没有可传播的环境声。</dd><dt>关于 IBM</dt><dd>尚未核实 IBM 与这套月球数据的合作关系，本作品不作相关合作声明。</dd></dl><a class="text-link" href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noopener noreferrer">查看 NASA 原始数据与署名 ↗</a><p class="fine-print">影像：NASA / GSFC / Arizona State University<br>地球纹理：Three.js 示例资源</p></section></div>
 </div>
</template>
