import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { BoatSimulationState } from "@naval/shared";

export interface DestroyerVisual {
  readonly root: Mesh;
  readonly shadowCasters: readonly Mesh[];
  update(state: BoatSimulationState, interpolation: number): void;
}

/** Procedural Flight IIA Arleigh Burke silhouette, in meters. Bow is +Z.
 * Public reference: https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2169871/destroyers-ddg-51/
 * Recognizable class features, not a shipyard-exact model of a particular hull.
 */
export function createDestroyer(scene: Scene): DestroyerVisual {
  const root = new Mesh("arleigh-burke-destroyer", scene);
  root.isVisible = false;
  const casters: Mesh[] = [];
  const paint = (name: string, color: string, roughness = .78, metallic = .12) => {
    const material = new PBRMaterial(name, scene);
    material.albedoColor = Color3.FromHexString(color);
    material.roughness = roughness;
    material.metallic = metallic;
    return material;
  };
  const gray = paint("haze-gray-steel", "#89969c");
  const light = paint("upperworks-gray", "#a5afb1");
  const deck = paint("non-skid-deck", "#424d53", .95);
  const dark = paint("exhaust-and-fittings", "#262e33");
  const exhaustBlack = paint("soot-black", "#111719", .95);
  const radar = paint("spy-1-array-faces", "#64757d", .65);
  const glass = paint("bridge-glazing", "#163740", .18, .4);
  const white = paint("deck-markings", "#d6d9d2");
  const safetyOrange = paint("safety-equipment-orange", "#dc5836", .72);
  const underwater = paint("antifouling-hull", "#633b34", .9);
  const register = (mesh: Mesh, material: PBRMaterial, parent = root) => {
    mesh.parent = parent;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    casters.push(mesh);
    return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material = gray, parent = root) => {
    const mesh = register(CreateBox(name, { width: w, height: h, depth: d }, scene), material, parent);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const cylinder = (name: string, diameter: number, height: number, x: number, y: number, z: number, material = gray, top = diameter, sides = 16) => {
    const mesh = register(CreateCylinder(name, { diameterBottom: diameter, diameterTop: top, height, tessellation: sides }, scene), material);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const tube = (name: string, points: number[][], radius: number, material = gray) =>
    register(CreateTube(name, { path: points.map(p => new Vector3(p[0], p[1], p[2])), radius, tessellation: 6, cap: Mesh.CAP_ALL }, scene), material);
  const tapered = (name: string, w: number, d: number, h: number, inset: number, x: number, y: number, z: number, material = gray) => {
    const positions = [-w/2,0,-d/2, w/2,0,-d/2, w/2,0,d/2, -w/2,0,d/2,
      -w/2+inset,h,-d/2+inset, w/2-inset,h,-d/2+inset, w/2-inset,h,d/2-inset, -w/2+inset,h,d/2-inset];
    const mesh = makeMesh(name, positions, [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7], scene);
    register(mesh, material).position.set(x,y,z);
    return mesh;
  };

  // Flared bow, fine entry, parallel midbody, and a broad transom.
  const stations = [
    [-77.645,6.7,4.8,4.2], [-65,8.3,6.4,4.3], [-42,9,7,4.5],
    [-12,9,7,4.8], [16,9,6.8,5.2], [37,8.2,5.7,5.65],
    [54,6.2,3.6,6.2], [68,3.45,1.55,6.8], [77.645,.04,.02,7.5],
  ];
  const positions: number[] = [], indices: number[] = [];
  for (const [z, beam, lower, sheer] of stations as [number,number,number,number][]) {
    positions.push(-lower,-5.4,z, lower,-5.4,z, beam*.84,-.5,z, beam,sheer,z, -beam,sheer,z, -beam*.84,-.5,z);
  }
  for (let s = 0; s < stations.length-1; s++) for (let e=0;e<6;e++) {
    const a=s*6+e,b=s*6+(e+1)%6,c=b+6,d=a+6;
    indices.push(a,d,b,b,d,c);
  }
  for (const s of [0,stations.length-1]) for(let i=1;i<5;i++) {
    const b=s*6;
    if(s===0) indices.push(b,b+i,b+i+1); else indices.push(b,b+i+1,b+i);
  }
  register(makeMesh("flared-displacement-hull", positions, indices, scene), gray);
  box("submerged-keel", 9, 1.2, 105, 0, -5.45, -8, underwater);
  // Deck surfaces follow the actual hull perimeter, rather than a rectangular slab.
  const dp: number[]=[], di:number[]=[];
  for(const [z,beam,,sheer] of stations as [number,number,number,number][]) dp.push(-beam+.08,sheer+.035,z, beam-.08,sheer+.035,z);
  for(let s=0;s<stations.length-1;s++){const a=s*2;di.push(a,a+2,a+1,a+1,a+2,a+3);}
  const deckMesh = register(makeMesh("shaped-weather-deck",dp,di,scene),deck);
  deckMesh.material!.backFaceCulling = false;

  tapered("forward-deckhouse",15.4,39,7.6,.9,0,5,16);
  tapered("aegis-bridge-block",13.9,17,7.1,1.2,0,12.6,25,light);
  box("bridge-wings",17.2,1.1,6.4,0,17.7,29,light);
  tapered("pilothouse",13.7,6,3.4,.55,0,18.2,29,light);
  box("bridge-roof",14.2,.35,6.6,0,21.7,29,gray);
  box("bridge-forward-brow",13.1,.2,.75,0,21.05,32.75,gray);
  for(let i=-5;i<=5;i++) {
    box("bridge-front-window",.94,1.22,.08,i*1.13,20.1,31.66,glass);
    box("bridge-window-mullion",.07,1.34,.13,i*1.13-.54,20.1,31.72,light);
  }
  for(const side of [-1,1]) {
    for(let i=0;i<4;i++) box("bridge-side-window",.09,1.2,.96,side*6.54,20.1,27.05+i*1.15,glass);
    box("bridge-wing-window",.09,.64,3.2,side*8.56,17.9,29,glass);
    box("SPY-1-side-array",.16,4.5,5.8,side*7.03,15.5,25,radar);
  }
  box("SPY-1-forward-array",5.8,4.5,.16,0,15.5,33.62,radar);
  box("SPY-1-aft-array",5.8,4.5,.16,0,15.5,16.38,radar);
  tapered("aft-deckhouse",14.8,39,6.9,.65,0,4.7,-26,gray);
  // Working-deck access, ventilation, and catwalk details on both raised deckhouses.
  for(const side of [-1,1]) {
    for(const z of [-.3,6.5,13.3,20.1,26.9,33.7]) {
      box("forward-house-side-vent",.1,1.2,2.8,side*7.56,8.8,z,radar);
      for(let y=8.35;y<=9.25;y+=.3) box("forward-house-vent-slat",.15,.07,2.55,side*7.64,y,z,light);
    }
    for(const z of [-39,-31,-23,-15,-7]) {
      box("aft-house-access-door",.12,2.25,1.45,side*7.4,7.2,z,dark);
      box("aft-house-door-inset",.14,1.7,1.02,side*7.49,7.2,z,radar);
      box("aft-house-side-window",.12,.42,2.4,side*7.38,10.1,z,glass);
    }
    box("forward-house-catwalk",1.05,.24,31,side*7.78,7.15,16,deck);
    box("aft-house-catwalk",1.0,.24,34,side*7.68,5.8,-26,deck);
    const guardRuns:[[number,number,number,number],[number,number,number,number]]=[
      [side*8.34,8.1,1,31],[side*8.18,6.75,-43,-9],
    ];
    for(const [x,y,z1,z2] of guardRuns) {
      tube("catwalk-guardrail-upper",[[x,y,z1],[x,y,z2]],.045,light);
      tube("catwalk-guardrail-mid",[[x,y-.55,z1],[x,y-.55,z2]],.035,light);
      for(let z=z1;z<=z2;z+=2.1) tube("catwalk-guardrail-stanchion",[[x,y-.62,z],[x,y+.06,z]],.04,light);
    }
    for(const z of [-35,-19,4,28]) {
      const x=side*7.55;
      tube("deckhouse-ladder-side-rail",[[x,5.9,z],[x,9.2,z]],.06,light);
      tube("deckhouse-ladder-side-rail",[[x,5.9,z+1.05],[x,9.2,z+1.05]],.06,light);
      for(let y=6.15;y<9;y+=.42) tube("deckhouse-ladder-rung",[[x,y,z],[x,y,z+1.05]],.045,light);
    }
    for(const z of [-58,-43,-27,-10,8,25,43,59]) {
      const x=side*(z>50?4.75:8.82);
      box("hull-service-door",.1,1.45,1.0,x,2.55,z,dark);
      box("hull-service-door-panel",.13,1.08,.72,x+side*.04,2.55,z,gray);
      box("hull-porthole",.11,.48,.7,x,4.1,z+2.2,glass);
      const ring=register(CreateTorus("life-ring",{diameter:1.05,thickness:.19,tessellation:12},scene),safetyOrange);
      ring.position.set(x+side*.12,5.55,z-2.5);ring.rotation.z=Math.PI/2;
    }
    for(const z of [-64,-48,-32,-16,0,16,32,48,64]) {
      const x=side*(z>55?4.5:z>40?6.0:8.7);
      box("deck-drainage-scupper",.1,.24,.55,x,5.18,z,radar);
    }
  }
  for(const [x,z] of [[-4,9],[4,9],[-4,20],[4,20],[-4,-10],[4,-10],[-5,48],[5,48]] as number[][]) {
    box("weather-deck-hatch-coaming",1.6,.12,2.1,x,5.5,z,dark);
    box("weather-deck-hatch-cover",1.3,.08,1.8,x,5.6,z,light);
    box("weather-deck-hatch-grip",.08,.12,.9,x,5.7,z,radar);
  }
  for(const side of [-1,1]) for(const z of [-72,-59,-43,-27,30,46,62,72]) {
    const x=side*(Math.abs(z)>65?3.4:Math.abs(z)>50?5.5:8.2);
    cylinder("mooring-bitt-base",.72,.38,x,5.25,z,dark);
    cylinder("mooring-bitt-post",.34,.72,x,5.78,z,light,.34,12);
  }
  // The aft flight deck remains empty; the helicopter hangar is closed.
  box("hangar-roof",15.1,.3,20,0,11.7,-36,deck);
  for(const side of [-1,1]) {
    box("hangar-door",5.4,5.8,.16,side*3.5,7.6,-45.6,dark);
    for(let y=5;y<10.5;y+=.6) box("hangar-door-slat",5.1,.08,.2,side*3.5,y,-45.72,gray);
    box("hangar-door-frame",.3,6.1,.4,side*6.35,7.65,-45.75,light);
    box("hangar-corner-fender",.32,5.9,.34,side*6.35,7.55,-25,radar);
    for(let z=-42;z<=-14;z+=4) box("hangar-roof-tie-down",.18,.1,.18,side*6.3,11.92,z,light);
  }
  // Two separate gas-turbine uptake groups, with paired black exhausts.
  for(const z of [4,-21]) {
    tapered("raked-funnel",9.8,9.2,8.6,1.05,0,12,z,light);
    box("funnel-cap",7.9,.65,7.3,0,20.75,z,dark);
    for(const side of [-1,1]) {
      cylinder("turbine-exhaust-rim",2.65,.22,side*2.05,21.25,z,dark);
      cylinder("turbine-exhaust",2.15,1.15,side*2.05,21.55,z,exhaustBlack,1.95,16);
      for(let y=13.6;y<18.2;y+=.48) box("funnel-side-louver",.14,.13,4.5,side*4.52,y,z,radar);
    }
    box("funnel-service-platform",10.6,.2,10.2,0,12.35,z,deck);
    for(const side of [-1,1]) tube("funnel-guardrail",[[side*5.1,13.1,z-4.6],[side*5.1,13.1,z+4.6]],.04,light);
  }
  // Aft 64-cell and forward 32-cell Mk 41 launch deck grids.
  const vls=(z:number,rows:number,y:number)=>{
    box("Mk41-launcher-coaming",7.35,.42,rows*1.3+.55,0,y,z,dark);
    for(let row=0;row<rows;row++) for(let col=0;col<8;col++) {
      const x=(col-3.5)*.86,cellZ=z+(row-(rows-1)/2)*1.3;
      box("VLS-cell-hatch-rim",.79,.13,1.18,x,y+.26,cellZ,radar);
      box("VLS-cell-hatch",.62,.1,1.0,x,y+.35,cellZ,light);
      box("VLS-hatch-lifting-point",.11,.08,.26,x,y+.42,cellZ-.32,dark);
    }
  };
  vls(42,4,5.95); vls(-30,8,12.05);
  cylinder("Mk45-gun-ring",4.5,.7,0,6.55,56,dark);
  tapered("Mk45-5-inch-gun",4.6,5.2,3.25,.9,0,6.8,56,light);
  tube("127mm-gun-barrel",[[0,8.6,58],[0,9.6,65.4]],.17,dark);
  cylinder("gun-mantlet",1.1,1.4,0,8.6,58,gray).rotation.x=Math.PI/2;

  tapered("main-mast-base",3.6,3.6,10,1.15,0,21.9,20,gray);
  cylinder("mast-pole",.55,10,0,36.7,20,gray,.22);
  box("mast-crossarm",11,.35,.65,0,31,20,gray);
  for(const side of [-1,1]) tube("mast-brace",[[0,25,20],[side*5.3,31,20]],.13);
  const scanner = box("rotating-search-radar",6.8,1.1,1.2,0,38.3,20,dark);
  box("mast-platform-upper",11,.28,4.4,0,33,20,deck);
  box("mast-signal-yard",9,.25,.32,0,34.7,20,gray);
  for(const side of [-1,1]) {
    tube("mast-lattice-leg",[[side*1.55,23,18.5],[side*.55,36.5,20]],.12,light);
    tube("mast-lattice-crossbrace",[[side*1.45,27,19],[0,30,19.5],[side*.85,33,20]],.075,gray);
    tube("mast-antenna-yardarm",[[side*2.2,35.5,20],[side*4.8,35.5,20]],.08,light);
    for(const z of [15,-14,-38]) {
      cylinder("tactical-communications-platform",2.5,.38,side*5.7,12.1,z,radar,2.5,16);
      const ball=register(CreateSphere("satcom-radome",{diameter:1.8,segments:12},scene),white);
      ball.position.set(side*5.7,13.15,z);
    }
  }
  for(const x of [-4.7,4.7]) cylinder("mast-whip-antenna",.1,4.5,x,33.2,20,dark);
  for(const [x,z,y] of [[-5,13,15],[5,13,15],[-5,-39,13],[5,-39,13]]) {
    cylinder("satcom-pedestal",1.1,1.7,x!,y!,z!);
    register(CreateSphere("satcom-radome",{diameter:2.5,segments:12},scene),white).position.set(x!,y!+1.5,z!);
  }
  // Phalanx silhouette on aft hangar roof.
  cylinder("CIWS-base",2,1.8,0,13,-42);
  cylinder("CIWS-white-radome",1.45,2.2,0,14.8,-42,white,1.2);
  for(let barrel=0;barrel<6;barrel++) {
    const gun=cylinder("CIWS-six-barrel-gatling",.14,3.8,(barrel-2.5)*.16,14.8,-44,dark,.14,8);
    gun.rotation.x=Math.PI/2;
  }
  for(const side of [-1,1]) {
    // Recessed ship's boat and its davit amidships.
    tapered("RHIB",1.9,7,.9,.3,side*7,6.8,-6,dark);
    tube("boat-davit",[[side*6,6,-4],[side*6,10,-4],[side*8.3,10,-4]],.16);
    for(const z of [-67,-54,47,66]) {
      const x=side*(z>60?3.2:z>40?5.7:6.3);
      cylinder("bollard",.45,.85,x,5.2,z,dark);
    }
    for(const [z,beam,,sheer] of stations.slice(0,-1) as [number,number,number,number][]) {
      tube("lifeline-stanchion",[[side*(beam-.2),sheer,z],[side*(beam-.2),sheer+1.15,z]],.045,light);
    }
    for(const height of [.55,1.15]) tube("deck-edge-lifeline",(stations as [number,number,number,number][]).map(([z,b,,y])=>[side*(b-.15),y+height,z]),.025,light);
    const nav=paint(side<0?"port-red":"starboard-green",side<0?"#dd3024":"#35d87b");
    nav.emissiveColor=Color3.FromHexString(side<0?"#aa160c":"#0d8e38");
    box("navigation-light",.3,.35,.4,side*8.65,18.35,30,nav);
    // Twin shafts and rudders, visible from below the waterline.
    tube("propeller-shaft",[[side*3.7,-3.8,-52],[side*3.7,-4.2,-70]],.27,dark);
    box("rudder",.35,3.1,3.7,side*3.7,-3.5,-73,gray);
  }
  // Painted flight deck, inset clear of the hangars and transom.
  const flightTexture=new DynamicTexture("flight-deck-markings",{width:512,height:1024},scene,true);
  const ctx=flightTexture.getContext();
  ctx.fillStyle="#424d53";ctx.fillRect(0,0,512,1024);
  ctx.strokeStyle="#d6d9d2";ctx.lineWidth=8;
  ctx.strokeRect(35,35,442,954);
  ctx.beginPath();
  for(let i=0;i<=64;i++){const a=i/64*Math.PI*2;const x=256+Math.cos(a)*166,y=560+Math.sin(a)*235;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
  ctx.stroke();
  ctx.beginPath();ctx.moveTo(256,35);ctx.lineTo(256,989);ctx.stroke();
  ctx.fillStyle="#d6d9d2";ctx.font="bold 110px sans-serif";ctx.fillText("H",216,595);
  flightTexture.update();
  const flightMaterial=paint("flight-deck", "#ffffff",.95);flightMaterial.albedoTexture=flightTexture;
  const flight=register(CreatePlane("empty-flight-deck-markings",{width:12.5,height:28,sideOrientation:Mesh.DOUBLESIDE},scene),flightMaterial);
  flight.rotation.x=Math.PI/2;flight.position.set(0,4.48,-62);
  const lettering=new DynamicTexture("hull-number",{width:256,height:128},scene,true);
  lettering.hasAlpha=true;lettering.drawText("96",null,102,"bold 110px sans-serif","#e6e8e3","transparent",true);
  const number=paint("hull-number-paint","#ffffff");number.albedoTexture=lettering;number.useAlphaFromAlbedoTexture=true;
  for(const side of [-1,1]) {
    const plate=register(CreatePlane("bow-hull-number",{width:4.4,height:2.2,sideOrientation:Mesh.DOUBLESIDE},scene),number);
    plate.position.set(side*6.66,3.4,48);plate.rotation.y=side<0?Math.PI/2:-Math.PI/2;
  }
  // Material batching keeps the detailed vessel to a small number of draw calls.
  for(const material of new Set(casters.filter(m=>m!==scanner).map(m=>m.material))) {
    const parts=casters.filter(m=>m!==scanner&&m.material===material);
    if(parts.length<2) continue;
    const merged=Mesh.MergeMeshes(parts,true,true);
    if(merged){merged.parent=root;merged.receiveShadows=true;merged.isPickable=false;
      for(const part of parts) casters.splice(casters.indexOf(part),1);
      casters.push(merged);
    }
  }
  return {root,shadowCasters:casters,update(state,interpolation){
    const t=Math.max(0,Math.min(1,interpolation));
    const lerp=(a:number,b:number)=>a+(b-a)*t;
    root.position.set(lerp(state.previousPositionX,state.positionX),lerp(state.previousPositionY,state.positionY),lerp(state.previousPositionZ,state.positionZ));
    root.rotation.set(-lerp(state.previousPitch,state.pitch),lerp(state.previousHeading,state.heading),lerp(state.previousRoll,state.roll));
    scanner.rotation.y=state.elapsedTime*.65;
  }};
}

function makeMesh(name:string,positions:number[],indices:number[],scene:Scene):Mesh {
  const normals:number[]=[];VertexData.ComputeNormals(positions,indices,normals);
  const data=new VertexData();data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=new Array(positions.length/3*2).fill(0);
  const mesh=new Mesh(name,scene);data.applyToMesh(mesh);mesh.convertToFlatShadedMesh();return mesh;
}
