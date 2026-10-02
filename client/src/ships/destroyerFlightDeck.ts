import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { addParkedSeahawk } from "./createSeahawk";

type FlightDeckPaint = Record<"gray" | "light" | "deck" | "dark" | "radar" | "glass" | "white" | "orange", PBRMaterial>;
const AFT_Z = -77.3, FORWARD_Z = -46.8, TEXTURE_WIDTH = 1024, TEXTURE_HEIGHT = 2048;

/** Aft aviation details conform to the ship's sheer and narrowing transom.
 * The supplied image guides the landing marks and parked-aircraft arrangement.
 */
export function addDestroyerFlightDeck(scene: Scene, root: Mesh, casters: Mesh[], paints: FlightDeckPaint,
  deckHeight: (z: number) => number, hullBeam: (z: number) => number): void {
  const { gray, light, deck, dark, radar, white, orange } = paints;
  const register = (mesh: Mesh, material: PBRMaterial) => {
    mesh.parent = root; mesh.material = material; mesh.isPickable = false;
    mesh.receiveShadows = true; casters.push(mesh); return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material = gray) => {
    const mesh = register(CreateBox(name, { width: w, height: h, depth: d }, scene), material);
    mesh.position.set(x, y, z); return mesh;
  };
  const cylinder = (name: string, diameter: number, height: number, x: number, y: number, z: number, material = gray) => {
    const mesh = register(CreateCylinder(name, { diameter, height, tessellation:12 }, scene), material);
    mesh.position.set(x,y,z); return mesh;
  };
  const tube = (name: string, path: number[][], radius: number, material = gray) => register(CreateTube(name, {
    path:path.map(([x,y,z])=>new Vector3(x,y,z)),radius,tessellation:5,cap:Mesh.CAP_ALL,
  },scene),material);
  const patch = (name: string, corners: number[][], uvs: number[], material: PBRMaterial) => {
    const positions=corners.flat(), indices=[0,1,2,0,2,3], normals:number[]=[];
    VertexData.ComputeNormals(positions,indices,normals);
    const data=new VertexData();data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=uvs;
    const mesh=register(new Mesh(name,scene),material);data.applyToMesh(mesh);return mesh;
  };

  const flightPaint=deck.clone("flight-deck-nonskid-and-landing-marks")!;
  flightPaint.albedoTexture=createFlightDeckTexture(scene,hullBeam);
  flightPaint.roughness=.98;flightPaint.metallic=.03;flightPaint.backFaceCulling=false;
  const positions:number[]=[],indices:number[]=[],uvs:number[]=[];
  const stations=[AFT_Z,-74,-70,-60,-50,FORWARD_Z];
  for(const z of stations)for(const side of [-1,1]){
    const x=side*(hullBeam(z)-.10);
    positions.push(x,deckHeight(z)+.018,z);
    uvs.push(x/18+.5,(z-AFT_Z)/(FORWARD_Z-AFT_Z));
  }
  for(let i=0;i<stations.length-1;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  const normals:number[]=[];VertexData.ComputeNormals(positions,indices,normals);
  const data=new VertexData();data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=uvs;
  const surface=register(new Mesh("conforming-aft-flight-deck",scene),flightPaint);data.applyToMesh(surface);

  // Recessed deck sockets, crossbars and a flush recovery/traverse track.
  for(let z=-74.5;z<-48.5;z+=2.7)for(let x=-6.75;x<=6.75;x+=2.25){
    if(Math.abs(x)>hullBeam(z)-1.0)continue;
    const y=deckHeight(z);
    cylinder("flight-deck-tie-down-socket",.20,.018,x,y+.032,z,radar);
    cylinder("flight-deck-tie-down-recess",.13,.014,x,y+.043,z,dark);
    box("flight-deck-socket-crossbar",.025,.018,.13,x,y+.054,z,light);
  }
  const track=(path:number[][])=>{
    tube("RAST-recessed-track",path.map(([x,z])=>[x,deckHeight(z)+.030,z]),.07,dark);
    for(const offset of [-.065,.065])tube("RAST-track-steel-edge",path.map(([x,z])=>[x+offset,deckHeight(z)+.046,z]),.012,radar);
  };
  track([[0,-67.8],[0,-56.0]]);
  for(const side of [-1,1])track([[0,-56],[side*2.85,-51.3],[side*2.85,-47.0]]);
  box("RAST-securing-carriage",.85,.10,1.3,0,deckHeight(-64)+.095,-64,radar);
  for(const side of [-1,1])box("RAST-carriage-guide",.12,.13,1.15,side*.44,deckHeight(-64)+.15,-64,light);

  // Lowered safety nets, with actual open mesh instead of solid side railings.
  const netPaint=gray.clone("flight-deck-open-netting")!;
  netPaint.albedoColor=Color3.White();netPaint.albedoTexture=createSafetyNetTexture(scene);
  netPaint.useAlphaFromAlbedoTexture=true;netPaint.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHATEST;
  netPaint.alphaCutOff=.3;netPaint.backFaceCulling=false;netPaint.twoSidedLighting=true;netPaint.metallic=.08;
  for(const side of [-1,1])for(let start=-77.25;start<-47.4;start+=3.8){
    const end=Math.min(start+3.62,-47.2);
    const innerA=[side*(hullBeam(start)-.04),deckHeight(start)+.04,start];
    const innerB=[side*(hullBeam(end)-.04),deckHeight(end)+.04,end];
    const outerA=[side*(hullBeam(start)+1.27),deckHeight(start)-.29,start];
    const outerB=[side*(hullBeam(end)+1.27),deckHeight(end)-.29,end];
    patch("flight-deck-lowered-safety-net",[innerA,outerA,outerB,innerB],[0,0,4.4,0,4.4,(end-start)/.3,0,(end-start)/.3],netPaint);
    tube("flight-deck-net-perimeter-frame",[innerA,outerA,outerB,innerB,innerA],.038,light);
    for(const z of [start,end]){
      const x=side*hullBeam(z),y=deckHeight(z);
      tube("flight-deck-net-support-brace",[[x,y-.68,z],[x+side*1.23,y-.30,z]],.045,gray);
      cylinder("flight-deck-net-hinge",.11,.12,x,y+.035,z,radar);
    }
  }
  for(let x=-6.7;x<6.6;x+=3.4){
    const end=Math.min(x+3.22,6.8),y=deckHeight(AFT_Z);
    const corners=[[x,y+.035,-77.45],[end,y+.035,-77.45],[end,y-.31,-78.7],[x,y-.31,-78.7]];
    patch("transom-lowered-safety-net",corners,[0,0,(end-x)/.3,0,(end-x)/.3,4.2,0,4.2],netPaint);
    tube("transom-safety-net-frame",[...corners,corners[0]],.038,light);
  }

  const edgeLight=white.clone("flight-deck-green-edge-light")!;
  edgeLight.albedoColor=Color3.FromHexString("#528f82");edgeLight.emissiveColor=new Color3(.08,.21,.15);
  for(const side of [-1,1]){
    for(let z=-75.4;z<=-49;z+=3.3){
      const x=side*(hullBeam(z)-.38),y=deckHeight(z);
      cylinder("flight-deck-flush-light-mount",.22,.035,x,y+.04,z,radar);
      cylinder("flight-deck-green-light-lens",.12,.028,x,y+.066,z,edgeLight);
    }
    const x=side*7.55,z=-48.9,y=deckHeight(z);
    box("aviation-fire-locker",.66,1.20,1.30,x,y+.61,z,light);
    box("aviation-fire-locker-door",.68,1.08,.055,x,y+.61,z-.68,gray);
    box("aviation-locker-latch",.16,.055,.06,x+side*.17,y+.64,z-.72,dark);
    box("aviation-fire-locker-ID",.25,.20,.065,x,y+.96,z-.72,orange);
    const reel=register(CreateTorus("flight-deck-fire-hose-reel",{diameter:.59,thickness:.16,tessellation:16},scene),orange);
    reel.rotation.x=Math.PI/2;reel.position.set(x,y+.48,z-1.27);
    tube("flight-deck-fire-hose-pipe",[[x,y+.06,z-1.32],[x,y+.65,z-1.32]],.045,light);
    for(const [a,b] of [[-75,-70],[-70,-60],[-60,-49]]) {
      const edge=(z:number,offset:number)=>[side*(hullBeam(z)-offset),deckHeight(z)+.024,z];
      patch("flight-deck-drainage-channel",[edge(a,.39),edge(a,.55),edge(b,.55),edge(b,.39)],[0,0,1,0,1,1,0,1],dark);
    }
    // Crash-rescue equipment stays in the margin beside the hangar.
    box("aviation-rescue-equipment-rack",.67,.55,1.8,side*7.7,y+.30,-51.3,radar);
    for(let i=0;i<3;i++)cylinder("aviation-extinguisher-cylinder",.20,.64,side*7.7,y+.70,-50.7-i*.48,orange);
    const landingLight=box("hangar-landing-floodlight",.42,.24,.22,side*3.7,10.83,-46.09,white);
    landingLight.rotation.x=.23;
  }
  // Hangar door thresholds and warning-striped roller housings.
  for(const side of [-1,1]){
    box("hangar-door-threshold",4.88,.045,.35,side*2.85,deckHeight(-46.85)+.05,-46.85,radar);
    box("hangar-door-roller-casing",5.08,.25,.29,side*2.85,10.69,-46.20,light);
    for(let i=0;i<10;i++){
      const stripe=box("hangar-threshold-warning-stripe",.15,.025,.31,side*2.85-2.15+i*.47,deckHeight(-46.85)+.083,-46.85,orange);
      stripe.rotation.y=.4;
    }
  }
  addParkedSeahawk(scene,root,casters,paints,deckHeight);
}

function createSafetyNetTexture(scene: Scene): DynamicTexture {
  const texture=new DynamicTexture("aviation-safety-net-weave",{width:64,height:64},scene,true);
  texture.hasAlpha=true;texture.wrapU=texture.wrapV=Texture.WRAP_ADDRESSMODE;texture.anisotropicFilteringLevel=8;
  const ctx=texture.getContext();ctx.clearRect(0,0,64,64);
  ctx.strokeStyle="rgba(156,164,148,.95)";ctx.lineWidth=3.5;
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(64,64);ctx.moveTo(0,64);ctx.lineTo(64,0);ctx.stroke();
  texture.update();return texture;
}

function createFlightDeckTexture(scene: Scene, hullBeam: (z:number)=>number): DynamicTexture {
  const texture=new DynamicTexture("weathered-aviation-deck-markings",{width:TEXTURE_WIDTH,height:TEXTURE_HEIGHT},scene,true);
  texture.anisotropicFilteringLevel=8;
  const ctx=texture.getContext();
  const px=(x:number)=>(x/18+.5)*TEXTURE_WIDTH;
  const py=(z:number)=>(FORWARD_Z-z)/(FORWARD_Z-AFT_Z)*TEXTURE_HEIGHT;
  let seed=9617;
  const random=()=>{seed=seed*16807%2147483647;return seed/2147483647;};
  ctx.fillStyle="#565953";ctx.fillRect(0,0,TEXTURE_WIDTH,TEXTURE_HEIGHT);
  for(let i=0;i<62000;i++){
    ctx.fillStyle=i%2?"rgba(16,23,22,.14)":"rgba(183,183,172,.11)";
    ctx.fillRect(random()*TEXTURE_WIDTH,random()*TEXTURE_HEIGHT,.8+random()*2,.8+random()*2);
  }
  // Subtle recoated panels, tire scuffs and drained-water streaks.
  ctx.fillStyle="rgba(31,36,35,.08)";
  for(const side of [-1,1])ctx.fillRect(px(side<0?-8.4:6.8),py(-49),px(1.3)-px(0),py(-75)-py(-49));
  for(let i=0;i<42;i++){
    const x=random()*12-6,z=-51-random()*23;
    ctx.strokeStyle=`rgba(25,31,29,${.025+random()*.055})`;ctx.lineWidth=2+random()*8;
    ctx.beginPath();ctx.moveTo(px(x),py(z));ctx.lineTo(px(x+.1),py(z-1.4-random()*2.6));ctx.stroke();
  }
  const line=(points:number[][],width=.14,color="#deded2")=>{
    ctx.strokeStyle=color;ctx.lineWidth=width/18*TEXTURE_WIDTH;ctx.beginPath();
    points.forEach(([x,z],i)=>i===0?ctx.moveTo(px(x),py(z)):ctx.lineTo(px(x),py(z)));ctx.stroke();
  };
  const boundary=[[-6.62,-48.65],[6.62,-48.65],[7.0,-59.5],[6.0,-75.45],[-6.0,-75.45],[-7.0,-59.5],[-6.62,-48.65]];
  line(boundary,.16);
  line([[-6.5,-49.0],[5.8,-75.15]],.20);
  line([[6.5,-49.0],[-5.8,-75.15]],.20);
  line([[0,-48.7],[0,-76.1]],.16);
  // Draw in metres so the landing circle remains circular on the 3D deck.
  const circle:number[][]=[];
  for(let i=0;i<=128;i++){const a=i/128*Math.PI*2;circle.push([Math.cos(a)*5.7,-62.7+Math.sin(a)*5.7]);}
  line(circle,.18);
  line([[-4.8,-55.1],[4.8,-55.1]],.22);
  line([[-4.1,-71.2],[4.1,-71.2]],.14);
  line([[0,-55.0],[-2.85,-51.2],[-2.85,-47.5]],.09,"#b9ad7a");
  line([[0,-55.0],[2.85,-51.2],[2.85,-47.5]],.09,"#b9ad7a");
  // Narrow hangar keep-clear zone, edge witness marks and inset sockets.
  line([[-6.3,-50.25],[6.3,-50.25]],.07,"#ba6860");
  for(let x=-6.2;x<6.2;x+=.45)line([[x,-47.3],[x+.32,-49.8]],.05,"#a69a71");
  for(let z=-74.5;z<-48.5;z+=2.7)for(let x=-6.75;x<=6.75;x+=2.25){
    if(Math.abs(x)>hullBeam(z)-1)continue;
    ctx.fillStyle="#343c39";ctx.beginPath();ctx.arc(px(x),py(z),5,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(176,184,174,.5)";ctx.lineWidth=1;ctx.stroke();
  }
  ctx.fillStyle="#d4d5c7";ctx.font="bold 90px sans-serif";ctx.fillText("96",px(0)-54,py(-74.0));
  // Scattered wear breaks up fresh, perfectly uniform painted lines.
  for(let i=0;i<1800;i++){
    ctx.fillStyle="rgba(85,89,83,.21)";ctx.fillRect(random()*TEXTURE_WIDTH,random()*TEXTURE_HEIGHT,1+random()*3,1+random()*5);
  }
  texture.update();return texture;
}
