import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
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

import { addDestroyerDetails, createDeckSurfaceTexture, createFacetedDeckhouse } from "./destroyerDetails";
import { addDestroyerForedeck } from "./destroyerForedeck";
import type { ForedeckGunControls } from "./destroyerForedeck";
import { addDestroyerHouseFront } from "./destroyerHouseFront";
import { DESTROYER_HOUSES, MAST_FOOT_Y, HANGAR_ROOF_Y, BOAT_DECK_Y, roofHeight, sideSurface, seatSurfaceBox, seatSurfaceCylinder } from "./destroyerMounts";
import type { DeckhouseLayout, MountSurface } from "./destroyerMounts";

export interface DestroyerVisual {
  readonly root: Mesh;
  readonly shadowCasters: readonly Mesh[];
  readonly gunCameraMount: TransformNode;
  update(state: BoatSimulationState, interpolation: number): void;
  updateGunAim(traverseDirection: number, elevationDirection: number, deltaSeconds: number): void;
  fireGun(worldTime: number): boolean;
  updateGunEffects(deltaSeconds: number, worldTime: number): void;
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
  const deck = paint("non-skid-deck", "#ffffff", .95);
  deck.albedoTexture = createDeckSurfaceTexture(scene);
  const dark = paint("exhaust-and-fittings", "#262e33");
  const exhaustBlack = paint("soot-black", "#111719", .95);
  const radar = paint("spy-1-array-faces", "#64757d", .65);
  const glass = paint("bridge-glazing", "#163740", .18, .4);
  const white = paint("deck-markings", "#d6d9d2");
  const safetyOrange = paint("safety-equipment-orange", "#dc5836", .72);
  const deckRed = paint("forecastle-red-safety-marking", "#b45d55", .94);
  const capstanGreen = paint("forecastle-green-capstan", "#187f6c", .72);
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
    [-77.645,6.9,4.9,4.3], [-70,7.8,6.1,4.35], [-60,8.55,6.6,4.4],
    [-42,9,7,4.5], [-22,9,7,4.7], [0,9,7,5.0], [16,8.85,6.8,5.2],
    [30,8.6,6.3,5.5], [42,7.85,5.3,5.85], [52,6.55,4.1,6.15],
    [60,5.2,2.9,6.5], [68,3.6,1.55,6.85], [73,1.9,.6,7.18], [77.645,.04,.02,7.5],
  ];
  const stationValue=(z:number,column:number)=>{
    for(let i=1;i<stations.length;i++)if(z<=stations[i][0]){
      const a=stations[i-1],b=stations[i],t=(z-a[0])/(b[0]-a[0]);return a[column]+(b[column]-a[column])*t;
    }return stations[stations.length-1][column];
  };
  const deckHeight=(z:number)=>stationValue(z,3)+.035;
  // Intersect the actual flared hull triangles, rather than its maximum beam.
  const hullSurface=(side:number,y:number,z:number):MountSurface=>{
    const water=(s:number[])=>[s[1]*.84,-.5,s[0]-Math.max(0,(s[0]-42)/(77.645-42))*7.6];
    const top=(s:number[])=>[s[1],s[3],s[0]];
    for(let i=1;i<stations.length;i++)for(const triangle of [
      [water(stations[i-1]),water(stations[i]),top(stations[i-1])],
      [top(stations[i-1]),water(stations[i]),top(stations[i])],
    ]){
      const [a,b,c]=triangle,by=b[1]-a[1],bz=b[2]-a[2],cy=c[1]-a[1],cz=c[2]-a[2];
      const det=by*cz-bz*cy,u=((y-a[1])*cz-(z-a[2])*cy)/det,v=(by*(z-a[2])-bz*(y-a[1]))/det;
      if(u>=-1e-5&&v>=-1e-5&&u+v<=1.00001){
        const dxdy=((b[0]-a[0])*cz-(c[0]-a[0])*bz)/det;
        const dxdz=(by*(c[0]-a[0])-cy*(b[0]-a[0]))/det;
        return {point:new Vector3(side*(a[0]+u*(b[0]-a[0])+v*(c[0]-a[0])),y,z),normal:new Vector3(side,-dxdy,-dxdz).normalize()};
      }
    }
    throw new Error('Hull fitting is outside its surface: '+y+', '+z);
  };
  const house=(name:string,layout:DeckhouseLayout,material=gray)=>register(createFacetedDeckhouse(name,
    layout.width,layout.depth,layout.height,layout.chamfer,layout.inset,scene),material).position.set(0,layout.y,layout.z);
  const wallBox=(name:string,h:number,d:number,side:number,y:number,z:number,layout:DeckhouseLayout,material=gray,thickness=.12,offset=0)=>
    seatSurfaceBox(box(name,thickness,h,d,0,0,0,material),sideSurface(layout,side,y,z),thickness,offset);
  const positions: number[] = [], indices: number[] = [];
  for (const [z, beam, lower, sheer] of stations as [number,number,number,number][]) {
    // Raked stem: the deck projects ahead of the waterline, instead of a
    // vertical triangular wall. The lower entry is fine below the bow flare.
    const rake=Math.max(0,(z-42)/(77.645-42));
    positions.push(-lower,-6.4,z-rake*12.4, lower,-6.4,z-rake*12.4,
      beam*.84,-.5,z-rake*7.6, beam,sheer,z, -beam,sheer,z, -beam*.84,-.5,z-rake*7.6);
  }
  for (let s = 0; s < stations.length-1; s++) for (let e=0;e<6;e++) {
    const a=s*6+e,b=s*6+(e+1)%6,c=b+6,d=a+6;
    indices.push(a,d,b,b,d,c);
  }
  for (const s of [0,stations.length-1]) for(let i=1;i<5;i++) {
    const b=s*6;
    if(s===0) indices.push(b,b+i,b+i+1); else indices.push(b,b+i+1,b+i);
  }
  const hullPaint = paint("weathered-hull-steel", "#ffffff", .84);
  const hullTexture = new DynamicTexture("hull-plating-and-streaks", {width:2048,height:256}, scene, true);
  const hc = hullTexture.getContext(); hc.fillStyle = "#909b9f"; hc.fillRect(0,0,2048,256);
  hc.fillStyle = "#353d40"; hc.fillRect(0,150,2048,5);
  hc.strokeStyle="rgba(54,67,71,.15)"; hc.lineWidth=1;
  for(let x=0;x<2048;x+=80){hc.beginPath();hc.moveTo(x,12);hc.lineTo(x,143);hc.stroke();}
  for(let y=45;y<140;y+=35){hc.beginPath();hc.moveTo(0,y);hc.lineTo(2048,y);hc.stroke();}
  for(let i=0;i<70;i++){const x=(i*379)%2048;const streak=hc.createLinearGradient(x,18,x,75);
    streak.addColorStop(0,"rgba(80,67,50,.19)");streak.addColorStop(1,"rgba(80,67,50,0)");
    hc.fillStyle=streak;hc.fillRect(x,18,2+i%3,57);}
  hullTexture.update(); hullPaint.albedoTexture=hullTexture;
  const hull = register(makeMesh("flared-displacement-hull", positions, indices, scene), hullPaint);
  const hullPositions=hull.getVerticesData("position")!;
  hull.setVerticesData("uv",Array.from({length:hullPositions.length/3},(_,i)=>[
    (hullPositions[i*3+2]+77.645)/155.29,(hullPositions[i*3+1]+6.4)/14,
  ]).flat());
  box("submerged-keel", 9, 1.2, 105, 0, -5.45, -8, underwater);
  // Deck surfaces follow the actual hull perimeter, rather than a rectangular slab.
  const dp: number[]=[], di:number[]=[];
  for(const [z,beam,,sheer] of stations as [number,number,number,number][]) dp.push(-beam+.08,sheer+.035,z, beam-.08,sheer+.035,z);
  for(let s=0;s<stations.length-1;s++){const a=s*2;di.push(a,a+1,a+2,a+1,a+3,a+2);}
  const deckMesh = register(makeMesh("shaped-weather-deck",dp,di,scene),deck);
  deckMesh.material!.backFaceCulling = false;

  house("forward-faceted-deckhouse",DESTROYER_HOUSES.forward);
  house("aegis-faceted-bridge-block",DESTROYER_HOUSES.aegis,light);
  box("bridge-wings",17.2,1.1,6.4,0,17.7,29,light);
  tapered("pilothouse",13.7,6,3.4,.55,0,18.2,29,light);
  box("bridge-roof",14.2,.35,6.6,0,21.7,29,gray);
  box("bridge-forward-brow",13.1,.2,.75,0,21.05,31.65,gray);
  for(let i=-5;i<=5;i++) {
    const surface={point:new Vector3(i*1.13,20.1,32-.55*(20.1-18.2)/3.4),normal:new Vector3(0,.55/3.4,1).normalize()};
    seatSurfaceBox(box("bridge-front-window",.08,1.22,.94,0,0,0,glass),surface,.08);
    const mullion={...surface,point:surface.point.add(new Vector3(-.54,0,0))};
    seatSurfaceBox(box("bridge-window-mullion",.13,1.34,.07,0,0,0,light),mullion,.13);
  }
  for(const side of [-1,1]) {
    for(let i=0;i<4;i++) wallBox("bridge-side-window",1.2,.96,side,20.1,27.2+i*.95,DESTROYER_HOUSES.pilothouse,glass,.09);
    box("bridge-wing-window",.09,.64,3.2,side*8.62,17.9,29,glass);
  }
  for(const side of [-1,1]) for(const end of [-1,1]) {
    const layout=DESTROYER_HOUSES.aegis, y=15.7;
    const inset=layout.inset*(y-layout.y)/layout.height;
    const z=layout.z+end*(layout.depth/2-layout.chamfer/2-inset);
    const surface=sideSurface(layout,side,y,z);
    // The complete octagon fits inside the chamfer; the back is seated in it.
    seatSurfaceCylinder(register(CreateCylinder("SPY1-octagonal-array-frame",{diameter:4.6,height:.16,tessellation:8},scene),gray),surface,.16);
    seatSurfaceCylinder(register(CreateCylinder("SPY1-octagonal-array-face",{diameter:4.34,height:.09,tessellation:8},scene),radar),surface,.09,.14);
  }
  house("twin-helicopter-hangar",DESTROYER_HOUSES.hangar);
  house("aft-uptake-working-deck",DESTROYER_HOUSES.aft);
  // The open boat deck between separate uptake groups is not a solid wall.
  box("amidships-working-deck",14.5,.22,8.5,0,5.2,-6.3,deck);
  // Fittings follow the actual raked walls and the flared hull surface.
  for(const side of [-1,1]) {
    for(const z of [1,7,13,20,26,30]) {
      wallBox("forward-house-side-vent",1.2,2.8,side,8.8,z,DESTROYER_HOUSES.forward,radar,.1);
      for(let y=8.35;y<=9.25;y+=.3) wallBox("forward-house-vent-slat",.07,2.55,side,y,z,DESTROYER_HOUSES.forward,light,.15,.075);
    }
    for(const z of [-39,-31,-21,-15]) {
      const layout=z>-24?DESTROYER_HOUSES.aft:DESTROYER_HOUSES.hangar;
      wallBox("aft-house-access-door",2.25,1.45,side,7.2,z,layout,dark);
      wallBox("aft-house-door-inset",1.7,1.02,side,7.2,z,layout,radar,.14,.1);
      wallBox("aft-house-side-window",.42,2.4,side,10.1,z,layout,glass);
    }
    // Each walkway has brackets reaching the wall; the aft runs follow the step.
    for(const [layout,z1,z2,y] of [[DESTROYER_HOUSES.forward,1,31,7.15],
      [DESTROYER_HOUSES.hangar,-43,-26,5.8],[DESTROYER_HOUSES.aft,-21.5,-13.5,5.8]] as const) {
      const inside=Math.abs(sideSurface(layout,side,y,(z1+z2)/2).point.x)-.04, outer=inside+.98;
      box("deckhouse-catwalk",1.05,.24,z2-z1,side*(inside+.48),y,(z1+z2)/2,deck);
      for(const h of [.55,1.1]) tube("catwalk-guardrail",[[side*outer,y+.12+h,z1],[side*outer,y+.12+h,z2]],.035,light);
      for(let z=z1;z<=z2+.01;z+=1.8) {
        tube("catwalk-guardrail-stanchion",[[side*outer,y+.11,z],[side*outer,y+1.28,z]],.04,light);
        const anchor=sideSurface(layout,side,y-.75,z).point;
        tube("catwalk-support-bracket",[[anchor.x,y-.75,z],[side*(outer-.1),y-.12,z]],.075,gray);
      }
    }
    for(const z of [-35,-19,4,28]) {
      const layout=z<0?(z<-25?DESTROYER_HOUSES.hangar:DESTROYER_HOUSES.aft):DESTROYER_HOUSES.forward;
      const p=(y:number,z:number)=>{const f=sideSurface(layout,side,y,z);return f.point.add(f.normal.scale(.15)).asArray();};
      for(const dz of [0,1.05]) tube("deckhouse-ladder-side-rail",[p(5.9,z+dz),p(9.2,z+dz)],.06,light);
      for(let y=6.15;y<9;y+=.42) tube("deckhouse-ladder-rung",[p(y,z),p(y,z+1.05)],.045,light);
      for(const y of [6,9]) for(const dz of [0,1.05]) tube("ladder-wall-standoff",[sideSurface(layout,side,y,z+dz).point.asArray(),p(y,z+dz)],.05,gray);
    }
    for(const z of [-58,-43,-27,-10,8,25,43,59]) {
      const door=hullSurface(side,2.55,z);
      seatSurfaceBox(box("hull-service-door",.1,1.45,1,0,0,0,dark),door,.1);
      seatSurfaceBox(box("hull-service-door-panel",.13,1.08,.72,0,0,0,gray),door,.13,.075);
      seatSurfaceBox(box("hull-porthole",.11,.48,.7,0,0,0,glass),hullSurface(side,4.1,z+2.2),.11);
      const ringZ=z-2.5, surface=hullSurface(side,deckHeight(ringZ)-.72,ringZ);
      const ring=register(CreateTorus("life-ring",{diameter:1.05,thickness:.19,tessellation:12},scene),safetyOrange);
      seatSurfaceCylinder(ring,surface,.19,.03);
      tube("life-ring-mount",[surface.point.asArray(),surface.point.add(surface.normal.scale(.15)).asArray()],.1,gray);
    }
    for(const z of [-64,-48,-32,-16,0,16,32,48,64])
      seatSurfaceBox(box("deck-drainage-scupper",.1,.24,.55,0,0,0,radar),hullSurface(side,deckHeight(z)-.32,z),.1);
  }
  for(const [x,z] of [[-4,9],[4,9],[-4,20],[4,20],[-4,-17],[4,-17],[-5,48],[5,48]]) {
    const y=z>35?deckHeight(z):z>0?roofHeight(DESTROYER_HOUSES.forward):roofHeight(DESTROYER_HOUSES.aft);
    box("weather-deck-hatch-coaming",1.6,.12,2.1,x,y+.055,z,dark);
    box("weather-deck-hatch-cover",1.3,.08,1.8,x,y+.14,z,light);
    box("weather-deck-hatch-grip",.08,.12,.9,x,y+.23,z,radar);
  }
  for(const side of [-1,1]) for(const z of [-72,-59,-43,-27,30,46,62,72]) {
    const x=side*(stationValue(z,1)-1.1), y=deckHeight(z);
    cylinder("mooring-bitt-base",.72,.38,x,y+.18,z,dark);
    cylinder("mooring-bitt-post",.34,.72,x,y+.70,z,light,.34,12);
  }
  // Closed twin hangars and an aft aviation working deck.
  box("hangar-roof",14.8,.3,22,0,11.7,-35.5,deck);
  for(const side of [-1,1]) {
    const layout=DESTROYER_HOUSES.hangar;
    const aftFace=(x:number,y:number):MountSurface=>({point:new Vector3(x,y,layout.z-layout.depth/2+layout.inset*(y-layout.y)/layout.height),
      normal:new Vector3(0,layout.inset/layout.height,-1).normalize()});
    seatSurfaceBox(box("hangar-door",.16,5.8,5.0,0,0,0,dark),aftFace(side*2.85,7.6),.16);
    for(let y=5;y<10.5;y+=.6)seatSurfaceBox(box("hangar-door-slat",.2,.08,4.75,0,0,0,gray),aftFace(side*2.85,y),.2,.13);
    for(const x of [.22,5.48])seatSurfaceBox(box("hangar-door-frame",.32,6.1,.28,0,0,0,light),aftFace(side*x,7.65),.32);
    wallBox("hangar-corner-fender",5.9,.34,side,7.65,-25,layout,radar,.32);
    for(let z=-42;z<=-26;z+=4)box("hangar-roof-tie-down",.18,.1,.18,side*6.3,HANGAR_ROOF_Y+.035,z,light);
  }
  // Two separate gas-turbine uptake groups, with paired black exhausts.
  for(const z of [4,-21]) {
    const baseY=roofHeight(z>0?DESTROYER_HOUSES.forward:DESTROYER_HOUSES.aft), topY=baseY+7.3;
    const layout={width:9.8,depth:9.2,height:7.3,chamfer:1.3,inset:.8,y:baseY,z};
    register(createFacetedDeckhouse("raked-uptake-group",9.8,9.2,7.3,1.3,.8,scene),light).position.set(0,baseY,z);
    box("funnel-cap",8.2,.32,7.6,0,topY+.16,z,light);
    for(const side of [-1,1]) {
      cylinder("turbine-exhaust-rim",2.65,.22,side*2.05,topY+.37,z,dark);
      cylinder("turbine-exhaust",2.2,.14,side*2.05,topY+.41,z,exhaustBlack,2.2,24);
      for(let y=baseY+1.1;y<topY-1.0;y+=.38) wallBox("funnel-side-louver",.13,4.5,side,y,z,layout,radar,.14);
    }
    cylinder("auxiliary-uptake-rim",1.65,.15,0,topY+.35,z+2.1,gray,1.65,20);
    cylinder("auxiliary-uptake-opening",1.35,.17,0,topY+.38,z+2.1,exhaustBlack,1.35,20);
    box("funnel-service-platform",10.6,.2,10.2,0,baseY+.2,z,deck);
    for(const side of [-1,1]) {
      tube("funnel-guardrail",[[side*5.1,baseY+1.35,z-4.6],[side*5.1,baseY+1.35,z+4.6]],.04,light);
      for(let dz=-4.6;dz<=4.6;dz+=1.53) tube("funnel-guardrail-post",[[side*5.1,baseY+.3,z+dz],[side*5.1,baseY+1.4,z+dz]],.035,light);
    }
  }
  // Aft 64-cell Mk 41 launch deck grid. The forward bank is detailed separately.
  const vls=(z:number,rows:number,y:number)=>{
    box("Mk41-launcher-coaming",7.35,.42,rows*1.3+.55,0,y,z,dark);
    for(let row=0;row<rows;row++) for(let col=0;col<8;col++) {
      const x=(col-3.5)*.86,cellZ=z+(row-(rows-1)/2)*1.3;
      box("VLS-cell-hatch-rim",.79,.13,1.18,x,y+.26,cellZ,radar);
      box("VLS-cell-hatch",.62,.1,1.0,x,y+.35,cellZ,light);
      box("VLS-hatch-lifting-point",.11,.08,.26,x,y+.42,cellZ-.32,dark);
    }
  };
  vls(-30,8,12.05);

  box("mast-deck-foundation",3.9,.28,3.9,0,MAST_FOOT_Y+.10,20,gray);
  tapered("main-mast-base",3.6,3.6,31.9-MAST_FOOT_Y,1.15,0,MAST_FOOT_Y+.12,20,gray);
  cylinder("mast-pole",.55,10,0,36.7,20,gray,.22);
  box("mast-crossarm",11,.35,.65,0,31,20,gray);
  for(const side of [-1,1]) tube("mast-brace",[[0,25,20],[side*5.3,31,20]],.13);
  const scanner = box("rotating-search-radar",6.8,1.1,1.2,0,38.3,20,dark);
  box("mast-platform-upper",11,.28,4.4,0,33,20,deck);
  box("mast-signal-yard",9,.25,.32,0,34.7,20,gray);
  for(const side of [-1,1]) {
    tube("mast-lattice-leg",[[side*1.55,MAST_FOOT_Y+.12,18.5],[side*.55,36.5,20]],.12,light);
    tube("mast-lattice-crossbrace",[[side*1.45,27,19],[0,30,19.5],[side*.85,33,20]],.075,gray);
    tube("mast-antenna-yardarm",[[side*2.2,35.68,20],[side*4.8,35.68,20]],.08,light);
    for(const z of [15,-12.6,-35.5]) {
      const x=side*(z===-12.6?3.6:5.7), roof=z>0?roofHeight(DESTROYER_HOUSES.forward):z>-25?roofHeight(DESTROYER_HOUSES.aft):HANGAR_ROOF_Y;
      cylinder("tactical-communications-platform",2.5,.38,x,roof+.18,z,radar,2.5,16);
      cylinder("radome-mount-neck",.72,.48,x,roof+.57,z,gray);
      const ball=register(CreateSphere("satcom-radome",{diameter:1.8,segments:12},scene),white);
      ball.position.set(x,roof+1.6,z);
    }
  }
  for(const x of [-4.7,4.7]) cylinder("mast-whip-antenna",.1,4.5,x,33.2,20,dark);
  for(const [x,z] of [[-5,13],[5,13],[-5,-39],[5,-39]]) {
    const roof=z>0?roofHeight(DESTROYER_HOUSES.forward):HANGAR_ROOF_Y;
    cylinder("satcom-pedestal",1.1,1.7,x,roof+.83,z);
    register(CreateSphere("satcom-radome",{diameter:2.5,segments:12},scene),white).position.set(x,roof+2.7,z);
  }
  // Phalanx silhouette on aft hangar roof.
  const ciwsY=HANGAR_ROOF_Y+.88;
  cylinder("CIWS-base",2,1.8,0,ciwsY,-42);
  cylinder("CIWS-white-radome",1.45,2.2,0,ciwsY+1.8,-42,white,1.2);
  for(let barrel=0;barrel<6;barrel++) {
    const gun=cylinder("CIWS-six-barrel-gatling",.14,3.8,(barrel-2.5)*.16,ciwsY+1.8,-44,dark,.14,8);
    gun.rotation.x=Math.PI/2;
  }
  for(const side of [-1,1]) {
    // Recessed ship's boat and its davit amidships.
    tapered("RHIB",1.9,7,.9,.3,side*7,6.8,-6,dark);
    cylinder("boat-davit-foot",.65,.35,side*6,BOAT_DECK_Y+.16,-4,gray);
    tube("boat-davit",[[side*6,BOAT_DECK_Y,-4],[side*6,10,-4],[side*7,10,-4]],.16);
    tube("boat-davit-brace",[[side*6,8.6,-4],[side*7,10,-4]],.11,gray);
    tube("boat-hoist-cable",[[side*7,10,-4],[side*7,7.5,-4]],.025,dark);
    for(const z of [-8,-4]) {
      const h=6.8-BOAT_DECK_Y;
      box("RHIB-cradle-leg",.22,h,1.25,side*7,BOAT_DECK_Y+h/2,z,gray);
      box("RHIB-cradle-saddle",1.75,.2,.45,side*7,6.78,z,radar);
    }
    for(const z of [-67,-54,47,66]) {
      const x=side*(stationValue(z,1)-1.3);
      cylinder("bollard",.45,.85,x,deckHeight(z)+.415,z,dark);
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

  }
  // Painted flight deck, inset clear of the hangars and transom.
  const flightTexture=new DynamicTexture("flight-deck-markings",{width:512,height:1024},scene,true);
  const ctx=flightTexture.getContext();
  ctx.fillStyle="#626a6c";ctx.fillRect(0,0,512,1024);
  let deckSeed=912;for(let i=0;i<18000;i++){deckSeed=deckSeed*16807%2147483647;const x=deckSeed/2147483647*512;deckSeed=deckSeed*16807%2147483647;const y=deckSeed/2147483647*1024;ctx.fillStyle=i%2?"rgba(26,33,34,.11)":"rgba(184,190,188,.12)";ctx.fillRect(x,y,1.5,1.5);}
  ctx.strokeStyle="#d6d9d2";ctx.lineWidth=8;
  ctx.strokeRect(35,35,442,954);
  ctx.strokeStyle="#dedbcb";ctx.lineWidth=12;
  ctx.beginPath();ctx.moveTo(65,75);ctx.lineTo(445,940);ctx.moveTo(445,75);ctx.lineTo(65,940);ctx.stroke();
  ctx.strokeStyle="#d6d9d2";ctx.lineWidth=7;
  ctx.beginPath();
  for(let i=0;i<=64;i++){const a=i/64*Math.PI*2;const x=256+Math.cos(a)*166,y=560+Math.sin(a)*235;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
  ctx.stroke();
  ctx.beginPath();ctx.moveTo(256,35);ctx.lineTo(256,989);ctx.stroke();
  ctx.fillStyle="#d6d9d2";ctx.font="bold 74px sans-serif";ctx.fillText("96",209,610);
  ctx.fillStyle="#303a3d";for(let x=65;x<480;x+=44)for(let y=90;y<960;y+=48){ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();}
  ctx.strokeStyle="#c6b483";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(55,55);ctx.lineTo(457,55);ctx.stroke();
  flightTexture.update();
  const flightMaterial=paint("flight-deck", "#ffffff",.95);flightMaterial.albedoTexture=flightTexture;
  const flight=register(CreatePlane("empty-flight-deck-markings",{width:12.5,height:28,sideOrientation:Mesh.DOUBLESIDE},scene),flightMaterial);
  flight.rotation.x=Math.PI/2;flight.position.set(0,4.47,-62);
  const lettering=new DynamicTexture("hull-number",{width:256,height:128},scene,true);
  lettering.hasAlpha=true;lettering.drawText("96",null,102,"bold 110px sans-serif","#e6e8e3","transparent",true);
  const number=paint("hull-number-paint","#ffffff");number.albedoTexture=lettering;number.useAlphaFromAlbedoTexture=true;
  for(const side of [-1,1]) {
    const plate=register(CreatePlane("bow-hull-number",{width:4.4,height:2.2,sideOrientation:Mesh.DOUBLESIDE},scene),number);
    const surface=hullSurface(side,3.4,48), up=Vector3.Up().subtract(surface.normal.scale(surface.normal.y)).normalize(), inward=surface.normal.negate();
    plate.rotationQuaternion=Quaternion.RotationQuaternionFromAxis(Vector3.Cross(up,inward).normalize(),up,inward);
    plate.position.copyFrom(surface.point.add(surface.normal.scale(.02)));
  }

  addDestroyerHouseFront(scene,root,casters,{gray,light,deck,dark,radar,glass,white,orange:safetyOrange},deckHeight);
  const foredeckGun: ForedeckGunControls = addDestroyerForedeck(scene,root,casters,{gray,light,dark,radar,white,orange:safetyOrange,red:deckRed,green:capstanGreen},deckHeight,z=>stationValue(z,1));
  const details=addDestroyerDetails(scene,root,casters,{gray,light,deck,dark,radar,glass,white,orange:safetyOrange},deckHeight,z=>stationValue(z,1),hullSurface);
  const animatedParts=new Set([scanner,...details.animated,...foredeckGun.animatedMeshes]);
  // Material batching keeps the detailed vessel to a small number of draw calls.
  for(const material of new Set(casters.filter(m=>!animatedParts.has(m)).map(m=>m.material))) {
    const parts=casters.filter(m=>!animatedParts.has(m)&&m.material===material);
    if(parts.length<2) continue;
    const merged=Mesh.MergeMeshes(parts,true,true);
    if(merged){merged.parent=root;merged.receiveShadows=true;merged.isPickable=false;
      for(const part of parts) casters.splice(casters.indexOf(part),1);
      casters.push(merged);
    }
  }
  let previousTime=0;
  return {root,shadowCasters:casters,gunCameraMount:foredeckGun.cameraMount,update(state,interpolation){
    const t=Math.max(0,Math.min(1,interpolation));
    const lerp=(a:number,b:number)=>a+(b-a)*t;
    root.position.set(lerp(state.previousPositionX,state.positionX),lerp(state.previousPositionY,state.positionY),lerp(state.previousPositionZ,state.positionZ));
    root.rotation.set(-lerp(state.previousPitch,state.pitch),lerp(state.previousHeading,state.heading),lerp(state.previousRoll,state.roll));
    scanner.rotation.y=state.elapsedTime*.65;
    details.update(state,Math.min(.1,Math.max(0,state.elapsedTime-previousTime)));previousTime=state.elapsedTime;
  },updateGunAim(traverseDirection,elevationDirection,deltaSeconds){
    foredeckGun.updateAim(traverseDirection,elevationDirection,deltaSeconds);
  },fireGun(worldTime){
    return foredeckGun.fire(worldTime);
  },updateGunEffects(deltaSeconds,worldTime){
    foredeckGun.updateFireEffects(deltaSeconds,worldTime);
  }};
}

function makeMesh(name:string,positions:number[],indices:number[],scene:Scene):Mesh {
  const normals:number[]=[];VertexData.ComputeNormals(positions,indices,normals);
  const data=new VertexData();data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=positions.flatMap((_,i)=>i%3===0?[positions[i]/18+.5,positions[i+2]/155.29+.5]:[]);
  const mesh=new Mesh(name,scene);data.applyToMesh(mesh);mesh.convertToFlatShadedMesh();return mesh;
}
