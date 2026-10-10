// Stage: renderer, camera, floor, glowing backdrop and lights. Per-clip looks will mostly change this file.
// ---------- scene
if(THREE.ColorManagement) THREE.ColorManagement.legacyMode=false;
const renderer=new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x020203);
scene.fog=new THREE.FogExp2(0x020203,0.04);
const camera=new THREE.PerspectiveCamera(34,16/9,0.1,60);
camera.position.set(0,1.32,6.4); camera.lookAt(0,1.05,-0.4);
// window.RW/RH: fixed output size (renderer page); otherwise follow the preview's stage width at 16:9
function resize(){ const w=window.RW||stage.clientWidth, h=window.RH||w*9/16; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); }
window.addEventListener('resize',resize); resize();

const floor=new THREE.Mesh(new THREE.PlaneGeometry(40,40), new THREE.MeshStandardMaterial({color:0x0e0d0c, roughness:0.42, metalness:0.15}));
floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);
const bdCanvas=document.createElement('canvas'); bdCanvas.width=512; bdCanvas.height=256;
{ const c=bdCanvas.getContext('2d'); const g=c.createRadialGradient(256,262,10,256,262,320);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.25,'rgba(255,255,255,0.5)'); g.addColorStop(0.6,'rgba(255,255,255,0.12)'); g.addColorStop(1,'rgba(255,255,255,0)');
  c.fillStyle='#000'; c.fillRect(0,0,512,256); c.fillStyle=g; c.fillRect(0,0,512,256); }
const bdTex=new THREE.CanvasTexture(bdCanvas); bdTex.encoding=THREE.sRGBEncoding;
const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(26,11), new THREE.MeshBasicMaterial({map:bdTex, color:0xffffff, fog:false}));
backdrop.position.set(0,5.5,-5.2); scene.add(backdrop);
const back=new THREE.SpotLight(0xffffff,1,30,0.6,0.9,1.0);
back.position.set(0.4,6.0,-4.8); back.target.position.set(0,0,-1.6);
back.castShadow=true; back.shadow.mapSize.set(2048,2048); back.shadow.bias=-0.0004; back.shadow.radius=5;
scene.add(back,back.target);
const rimL=new THREE.SpotLight(0xffffff,1,25,0.5,0.9,1.0); rimL.position.set(-5,3.2,-4.0); rimL.target.position.set(0,1.3,-0.4); scene.add(rimL,rimL.target);
const rimR=new THREE.SpotLight(0xffffff,1,25,0.5,0.9,1.0); rimR.position.set(5,3.2,-4.0); rimR.target.position.set(0,1.3,-0.4); scene.add(rimR,rimR.target);
const front=new THREE.SpotLight(0xffffff,1,30,0.55,0.95,1.2); front.position.set(0,6,6); front.target.position.set(0,1,-0.3); scene.add(front,front.target);
const fill=new THREE.HemisphereLight(0xb8b4c8,0x15120f,0.1); scene.add(fill);

