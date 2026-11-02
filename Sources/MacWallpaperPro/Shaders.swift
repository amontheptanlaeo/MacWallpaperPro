import Foundation

/// Wallpaper แบบ GPU: หน้า HTML ที่รัน fragment shader (WebGL) เต็มจอ
enum Shaders {
    static func html(fragment: String, scale: Double) -> String {
        template
            .replacingOccurrences(of: "__SCALE__", with: String(format: "%.2f", scale))
            .replacingOccurrences(of: "__SRC__", with: fragment.replacingOccurrences(of: "`", with: ""))
    }

    static func params(_ c: Config) -> String {
        String(format: "{\"c1\":%@,\"c2\":%@,\"c3\":%@,\"speed\":%.3f}",
               c.color1.js, c.color2.js, c.color3.js, c.speed)
    }

    /// wallpaper จาก Community: ส่งเฉพาะความเร็ว — สีให้เป็นไปตามที่ผู้สร้างออกแบบไว้
    static func speedOnly(_ c: Config) -> String {
        String(format: "{\"speed\":%.3f}", c.speed)
    }

    static func source(for preset: WallpaperPreset) -> String {
        switch preset {
        case .aurora: aurora
        case .liquid: liquid
        case .plasma: plasma
        case .synthwave: synthwave
        case .starfield: starfield
        }
    }

    private static let template = #"""
    <!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;overflow:hidden;background:#000}
    canvas{width:100vw;height:100vh;display:block}
    #err{position:fixed;left:24px;bottom:24px;color:#ff6b6b;font:13px Menlo,monospace;white-space:pre-wrap;max-width:70vw}
    </style></head><body><canvas id="c"></canvas><div id="err"></div><script>
    let P={c1:[1,1,1],c2:[1,0,1],c3:[0,0,0],speed:1};
    window.setP=o=>{P=o};
    const cv=document.getElementById('c');
    const gl=cv.getContext('webgl',{antialias:false,preserveDrawingBuffer:true});
    const vs='attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs='precision highp float;uniform float u_time;uniform vec2 u_res;uniform vec3 u_c1,u_c2,u_c3;\n'+`__SRC__`;
    function sh(t,s){const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);
      if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw 'Shader error:\n'+gl.getShaderInfoLog(o);return o}
    try{
      const pr=gl.createProgram();
      gl.attachShader(pr,sh(gl.VERTEX_SHADER,vs));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,fs));
      gl.linkProgram(pr);gl.useProgram(pr);
      const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const loc=gl.getAttribLocation(pr,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
      const U=n=>gl.getUniformLocation(pr,n);
      const ut=U('u_time'),ur=U('u_res'),u1=U('u_c1'),u2=U('u_c2'),u3=U('u_c3');
      const scale=__SCALE__;
      function resize(){cv.width=innerWidth*scale;cv.height=innerHeight*scale;gl.viewport(0,0,cv.width,cv.height)}
      addEventListener('resize',resize);resize();
      let last=performance.now(),T=0;
      function f(now){const dt=Math.min(.1,(now-last)/1000);last=now;T+=dt*P.speed;
        gl.uniform1f(ut,T);gl.uniform2f(ur,cv.width,cv.height);
        gl.uniform3fv(u1,P.c1);gl.uniform3fv(u2,P.c2);gl.uniform3fv(u3,P.c3);
        gl.drawArrays(gl.TRIANGLES,0,6);requestAnimationFrame(f)}
      requestAnimationFrame(f);
    }catch(e){document.getElementById('err').textContent=String(e)}
    </script></body></html>
    """#

    private static let noise = """
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
    float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.;a*=.5;}return v;}

    """

    static let aurora = noise + """
    void main(){
      vec2 uv=gl_FragCoord.xy/u_res; vec2 p=uv*vec2(u_res.x/u_res.y,1.); float t=u_time*.15;
      vec3 col=u_c3;
      for(int i=0;i<3;i++){ float fi=float(i);
        float band=fbm(vec2(p.x*1.4+t+fi*1.7,t*.5+fi));
        float y=.42+.28*band+fi*.07; float d=uv.y-y;
        float glow=exp(-d*d*(d>0.?18.:90.))*(.55+.45*fbm(vec2(p.x*7.+t*2.,fi*3.)));
        col+=mix(u_c1,u_c2,fi/2.)*glow*.85; }
      col+=u_c2*.12*(1.-uv.y);
      col+=step(.9975,hash(floor(gl_FragCoord.xy/2.)))*uv.y*.7;
      gl_FragColor=vec4(col,1.);
    }
    """

    static let liquid = """
    void main(){
      vec2 uv=gl_FragCoord.xy/u_res; float t=u_time*.25; vec2 p=uv*1.6;
      for(int i=1;i<7;i++){ float fi=float(i);
        p.x+=.35/fi*sin(fi*2.6*p.y+t+fi*1.3);
        p.y+=.35/fi*cos(fi*2.2*p.x+t*.8+fi); }
      float v=.5+.5*sin(p.x*2.2+p.y*1.4); float w=.5+.5*cos(p.y*2.4-t);
      vec3 col=mix(u_c1,u_c2,smoothstep(.1,.9,v)); col=mix(col,u_c3,w*.55);
      gl_FragColor=vec4(col,1.);
    }
    """

    static let plasma = """
    void main(){
      vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y; float t=u_time*.5;
      float v=sin(uv.x*3.+t)+sin(uv.y*4.-t*1.3)+sin((uv.x+uv.y)*3.+t*.7)+sin(length(uv*4.)-t*1.7);
      v=v*.25+.5;
      vec3 col=mix(u_c3,u_c1,smoothstep(.2,.6,v)); col=mix(col,u_c2,smoothstep(.55,.95,v));
      gl_FragColor=vec4(col,1.);
    }
    """

    static let synthwave = """
    void main(){
      vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y; float t=u_time;
      vec3 col=mix(u_c3,u_c2*.45,smoothstep(.5,-.05,uv.y));
      vec2 sp=uv-vec2(0.,.2); float r=length(sp);
      float sun=smoothstep(.27,.26,r);
      float cut=step(0.,sin(uv.y*90.-t*2.))+step(.16,uv.y);
      sun*=clamp(cut,0.,1.);
      col=mix(col,mix(u_c2,u_c1,clamp((uv.y-.0)*2.2,0.,1.)),sun);
      col+=u_c1*exp(-r*3.5)*.3;
      if(uv.y<0.){
        float h=-uv.y; float z=.3/h; vec2 g=vec2(uv.x*z,z+t*1.2);
        vec2 f=abs(fract(g)-.5); float w=.012*z+.01;
        float l=max(smoothstep(.5-w,.5,f.x),smoothstep(.5-w,.5,f.y));
        col=mix(u_c3*.6,u_c1,l*exp(-z*.12));
        col+=u_c2*exp(-h*14.)*.6;
      }
      gl_FragColor=vec4(col,1.);
    }
    """

    static let starfield = """
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y; vec3 col=u_c3*(1.-length(uv)*.6); float t=u_time*.08;
      for(int i=0;i<6;i++){ float fi=float(i);
        float d=fract(fi/6.+t); float sc=mix(22.,.6,d); float fade=d*smoothstep(1.,.85,d);
        vec2 p=uv*sc+fi*17.3; vec2 id=floor(p); vec2 gv=fract(p)-.5;
        float h=hash(id); vec2 off=vec2(h,fract(h*34.))-.5;
        float dist=length(gv-off*.8);
        float star=.018/dist*smoothstep(.45,.1,dist)*step(.4,h);
        col+=star*fade*mix(u_c1,u_c2,fract(h*7.)); }
      gl_FragColor=vec4(col,1.);
    }
    """
}
