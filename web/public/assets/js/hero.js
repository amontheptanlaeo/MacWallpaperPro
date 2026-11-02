// Landing hero: a raw-WebGL live wallpaper ("aurora silk") that bends toward the cursor.
// Budget rules: DPR capped, rendered below native resolution (the scene is soft anyway), paused when
// offscreen or the tab is hidden, a single static frame for prefers-reduced-motion, and a visible
// pause button. If WebGL is unavailable the CSS poster underneath stays.
import { reduceMotion } from "./site.js";

const hero = document.querySelector("[data-hero]");
const canvas = hero?.querySelector("[data-hero-canvas]");
const toggle = hero?.querySelector("[data-hero-toggle]");
const content = hero?.querySelector("[data-parallax]");

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uHover;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 r=mat2(.8,.6,-.6,.8);
  for(int i=0;i<5;i++){v+=a*noise(p);p=r*p*2.02+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  vec2 p=vec2((uv.x-.5)*asp,uv.y-.5);
  vec2 m=vec2((uMouse.x-.5)*asp,uMouse.y-.5);
  vec2 d=p-m; float r2=dot(d,d);
  p-=d*.24*exp(-r2*5.)*uHover;                      // gravity lens around the cursor
  float t=uTime*.035;
  vec2 q=vec2(fbm(p*1.3+vec2(0.,t)),fbm(p*1.3+vec2(5.2,1.3)-t));
  vec2 w=vec2(fbm(p*1.7+2.6*q+vec2(1.7,9.2)+t*1.4),fbm(p*1.7+2.6*q+vec2(8.3,2.8)-t*1.1));
  float f=fbm(p*1.1+2.2*w);
  float folds=pow(.5+.5*sin(f*14.+w.x*6.-uTime*.22),6.);   // thin silk highlights
  vec3 ink=vec3(.027,.031,.078);
  vec3 iris=vec3(.647,.592,1.);
  vec3 aqua=vec3(.424,.91,.855);
  vec3 candy=vec3(1.,.62,.81);
  float glow=smoothstep(.2,.88,f);
  vec3 tint=mix(iris,aqua,smoothstep(.35,.8,w.x));
  tint=mix(tint,candy,smoothstep(.38,.72,q.y)*.9);
  tint=mix(tint,vec3(.42,.36,1.),smoothstep(.55,.95,w.y)*.5);
  vec3 col=ink+tint*glow*.95+tint*folds*glow*.9;
  col+=vec3(.08,.05,.2)*smoothstep(.0,1.,uv.y);
  float shape=smoothstep(-.95,.75,p.x*.62+p.y*.8+.18);   // brighter top-right, calm where text sits
  col=mix(ink*.8,col,.22+.78*shape);
  vec2 sp=(uv*vec2(asp,1.)+(uMouse-.5)*.02)*70.;            // star layer with its own parallax
  vec2 cell=floor(sp); float h=hash(cell);
  vec2 fp=fract(sp)-.5-(vec2(hash(cell+3.1),hash(cell+7.7))-.5)*.6;
  float star=smoothstep(.07,0.,length(fp))*step(.972,h)*(.55+.45*sin(uTime*1.3+h*40.));
  col+=vec3(.92,.93,1.)*star*(1.-glow*.85);
  col+=mix(aqua,iris,.5)*.12*exp(-r2*16.)*uHover;
  col*=1.-.32*length(uv-.5);
  col+=(hash(gl_FragCoord.xy+fract(uTime))-.5)/255.;       // dither against banding
  gl_FragColor=vec4(col,1.);
}`;

function boot() {
  if (!hero || !canvas) return;
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false });
  if (!gl) return;

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = sh(gl.VERTEX_SHADER, VERT);
  const fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {
    res: gl.getUniformLocation(prog, "uRes"),
    time: gl.getUniformLocation(prog, "uTime"),
    mouse: gl.getUniformLocation(prog, "uMouse"),
    hover: gl.getUniformLocation(prog, "uHover"),
  };

  const small = matchMedia("(max-width: 700px)").matches;
  const SCALE = small ? 0.5 : 0.72;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr * SCALE));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr * SCALE));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };

  const target = { x: 0.68, y: 0.62, hover: 0 };
  const cur = { x: 0.68, y: 0.62, hover: 0 };
  let lastMove = -1e9;
  const T0 = performance.now() - 40000; // start mid-flow so the first frame already looks rich
  let raf = 0;
  let visible = true;
  let paused = false;

  const draw = (now) => {
    resize();
    const time = (now - T0) / 1000;
    if (now - lastMove > 2500) {
      // Idle: the light wanders slowly on its own.
      target.x = 0.62 + Math.sin(time * 0.13) * 0.22;
      target.y = 0.58 + Math.cos(time * 0.17) * 0.18;
      target.hover = 0.55;
    }
    cur.x += (target.x - cur.x) * 0.06;
    cur.y += (target.y - cur.y) * 0.06;
    cur.hover += (target.hover - cur.hover) * 0.05;
    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform1f(U.time, time);
    gl.uniform2f(U.mouse, cur.x, cur.y);
    gl.uniform1f(U.hover, cur.hover);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (content) {
      content.style.setProperty("--px", ((cur.x - 0.5) * 2).toFixed(3));
      content.style.setProperty("--py", ((0.5 - cur.y) * 2).toFixed(3));
    }
  };

  const loop = (now) => {
    raf = 0;
    if (!visible || paused || document.hidden) return;
    draw(now);
    raf = requestAnimationFrame(loop);
  };
  const start = () => {
    if (!raf && visible && !paused && !document.hidden) raf = requestAnimationFrame(loop);
  };

  if (reduceMotion.matches) {
    draw(performance.now());
    hero.classList.add("is-live");
    if (toggle) toggle.hidden = true;
    addEventListener("resize", () => draw(performance.now()), { passive: true });
    return;
  }

  hero.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    target.x = (e.clientX - r.left) / r.width;
    target.y = 1 - (e.clientY - r.top) / r.height;
    target.hover = 1;
    lastMove = performance.now();
  }, { passive: true });
  hero.addEventListener("pointerleave", () => (lastMove = -1e9), { passive: true });

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    start();
  }).observe(hero);
  document.addEventListener("visibilitychange", start);

  // Gentle scroll depth: the scene sinks back as you scroll past it.
  addEventListener("scroll", () => {
    if (!visible) return;
    const p = Math.min(1, scrollY / Math.max(1, hero.offsetHeight));
    hero.style.setProperty("--scroll", p.toFixed(3));
  }, { passive: true });

  toggle?.addEventListener("click", () => {
    paused = !paused;
    toggle.setAttribute("aria-pressed", String(paused));
    toggle.setAttribute("aria-label", paused ? toggle.dataset.labelPlay : toggle.dataset.labelPause);
    start();
  });

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    hero.classList.remove("is-live");
    cancelAnimationFrame(raf);
    raf = 0;
    paused = true;
  });

  draw(performance.now());
  requestAnimationFrame(() => hero.classList.add("is-live"));
  start();
}

boot();
