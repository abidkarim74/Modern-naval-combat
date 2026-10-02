import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { mergeStaticMeshes } from "./mergeStaticMeshes";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { BoatSimulationState } from "@naval/shared";

import { addDestroyerDetails, createDeckSurfaceTexture, createFacetedDeckhouse } from "./destroyerDetails";
import { addDestroyerForedeck } from "./destroyerForedeck";
import type { ForedeckGunControls } from "./destroyerForedeck";
import { createVlsLaunchCell } from "./destroyerVls";
import type { VlsLaunchCell } from "./destroyerVls";
import { addDestroyerHouseFront } from "./destroyerHouseFront";
import { addDestroyerFlightDeck } from "./destroyerFlightDeck";
import { addDestroyerMast } from "./destroyerMast";
import { addDestroyerReferenceFittings } from "./destroyerReferenceFittings";
import { createDestroyerHullPaint, createDestroyerUpperworksPaint } from "./destroyerSurface";
import { DESTROYER_HOUSES, HANGAR_ROOF_Y, roofHeight, sideSurface, seatSurfaceBox, seatSurfaceCylinder } from "./destroyerMounts";
import type { DeckhouseLayout, MountSurface } from "./destroyerMounts";

export interface DestroyerVisual {
  readonly root: Mesh;
  readonly shadowCasters: readonly Mesh[];
  readonly gunCameraMount: TransformNode;
  readonly missileLaunchCells: readonly VlsLaunchCell[];
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
  const gray = createDestroyerUpperworksPaint(scene,"haze-gray-steel", "#9ba5a7");
  const light = createDestroyerUpperworksPaint(scene,"upperworks-gray", "#afb7b7");
  const deck = paint("non-skid-deck", "#ffffff", .95);
  deck.albedoTexture = createDeckSurfaceTexture(scene);
  const dark = paint("exhaust-and-fittings", "#262e33");
  const exhaustBlack = paint("soot-black", "#111719", .95);
  const radar = paint("fittings-gray", "#66767b", .8);
  const arrayPaint = paint("spy-1-array-faces", "#acb5b4", .9, .03);
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
  const controlStations = [
    [-77.645,6.9,4.9,4.3], [-70,7.8,6.1,4.35], [-60,8.55,6.6,4.4],
    [-42,9,7,4.5], [-22,9,7,4.7], [0,9,7,5.0], [16,8.85,6.8,5.2],
    [30,8.6,6.3,5.5], [42,7.85,5.3,5.85], [52,6.55,4.1,6.15],
    [60,5.2,2.9,6.5], [68,3.6,1.55,6.85], [73,1.9,.6,7.18], [77.645,.04,.02,7.5],
  ];
  // Monotone Hermite stations preserve the fine entry without visible straight-sided kinks.
  const stationSlope=(i:number,c:number)=>{
    const a=controlStations[Math.max(0,i-1)],b=controlStations[i],d=controlStations[Math.min(controlStations.length-1,i+1)];
    if(i===0)return (d[c]-b[c])/(d[0]-b[0]);
    if(i===controlStations.length-1)return (b[c]-a[c])/(b[0]-a[0]);
    const left=(b[c]-a[c])/(b[0]-a[0]),right=(d[c]-b[c])/(d[0]-b[0]);
    if(left*right<=0)return 0;
    const h0=b[0]-a[0],h1=d[0]-b[0],w0=2*h1+h0,w1=h1+2*h0;
    return (w0+w1)/(w0/left+w1/right);
  };
  const stations:number[][]=[];
  for(let i=0;i<controlStations.length-1;i++) {
    const a=controlStations[i],b=controlStations[i+1],span=b[0]-a[0],count=Math.ceil(span/2.5);
    for(let j=0;j<count;j++) {
      const t=j/count,t2=t*t,t3=t2*t,station=[a[0]+span*t];
      for(let c=1;c<=3;c++)station.push((2*t3-3*t2+1)*a[c]+(t3-2*t2+t)*span*stationSlope(i,c)+(-2*t3+3*t2)*b[c]+(t3-t2)*span*stationSlope(i+1,c));
      stations.push(station);
    }
  }
  stations.push(controlStations[controlStations.length-1]);
  const hullRing=(s:number[])=>{
    const [z,b,lower,sheer]=s,rake=Math.max(0,(z-42)/(77.645-42));
    return [[-lower,-6.4,z-rake*8.4],[lower,-6.4,z-rake*8.4],
      [b*.69,-3.0,z-rake*6.2],[b*.85,-.3,z-rake*4.4],[b*.95,sheer*.49,z-rake*2.1],[b,sheer,z],
      [-b,sheer,z],[-b*.95,sheer*.49,z-rake*2.1],[-b*.85,-.3,z-rake*4.4],[-b*.69,-3,z-rake*6.2]];
  };
  const stationValue=(z:number,column:number)=>{
    for(let i=1;i<stations.length;i++)if(z<=stations[i][0]){
      const a=stations[i-1],b=stations[i],t=(z-a[0])/(b[0]-a[0]);return a[column]+(b[column]-a[column])*t;
    }return stations[stations.length-1][column];
  };
  const deckHeight=(z:number)=>stationValue(z,3)+.035;
  // Intersect the actual flared hull triangles, rather than its maximum beam.
  const hullSurface=(side:number,y:number,z:number):MountSurface=>{
    for(let i=1;i<stations.length;i++)for(const e of [3,4])for(const triangle of [
      [hullRing(stations[i-1])[e],hullRing(stations[i])[e],hullRing(stations[i-1])[e+1]],
      [hullRing(stations[i-1])[e+1],hullRing(stations[i])[e],hullRing(stations[i])[e+1]],
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
  const sectionSize=10;
  for(const station of stations)for(const p of hullRing(station))positions.push(...p);
  for(let s=0;s<stations.length-1;s++)for(let e=0;e<sectionSize;e++) {
    const a=s*sectionSize+e,b=s*sectionSize+(e+1)%sectionSize,c=b+sectionSize,d=a+sectionSize;
    indices.push(a,d,b,b,d,c);
  }
  for(const s of [0,stations.length-1])for(let i=1;i<sectionSize-1;i++) {
    const b=s*sectionSize;
    if(s===0)indices.push(b,b+i,b+i+1);else indices.push(b,b+i+1,b+i);
  }
  const hullPaint = createDestroyerHullPaint(scene);
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
    seatSurfaceCylinder(register(CreateCylinder("SPY1-octagonal-array-frame",{diameter:5.20,height:.16,tessellation:8},scene),gray),surface,.16);
    seatSurfaceCylinder(register(CreateCylinder("SPY1-octagonal-array-face",{diameter:5.02,height:.09,tessellation:8},scene),arrayPaint),surface,.09,.14);
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
    for(const z of [-58,-30,12]) {
      const door=hullSurface(side,2.55,z);
      seatSurfaceBox(box("hull-service-door",.075,1.10,.78,0,0,0,radar),door,.075);
      seatSurfaceBox(box("hull-service-door-panel",.08,.93,.64,0,0,0,gray),door,.08,.06);
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
  // Separate raked gas-turbine uptake houses with exposed paired black stacks.
  for(const z of [4,-20]) {
    const baseY=roofHeight(z>0?DESTROYER_HOUSES.forward:DESTROYER_HOUSES.aft), topY=baseY+6.7;
    const layout={width:9.8,depth:9.2,height:6.7,chamfer:1.3,inset:.8,y:baseY,z};
    register(createFacetedDeckhouse("raked-uptake-group",9.8,9.2,6.7,1.3,.8,scene),light).position.set(0,baseY,z);
    box("funnel-cap",8.25,.22,7.65,0,topY+.11,z,gray);
    for(const side of [-1,1]) {
      const sx=side*2.15;
      cylinder("turbine-stack-seat",2.7,.26,sx,topY+.29,z,gray);
      cylinder("turbine-stack-black-sleeve",2.35,1.55,sx,topY+1.16,z,exhaustBlack,2.38,32);
      for(const h of [.47,.79,1.15,1.57,1.93]) cylinder("turbine-stack-flange",2.52,.075,sx,topY+h,z,dark,2.52,32);
      // Recessed open mouth: the inner bore remains dark rather than a gray cap.
      cylinder("turbine-exhaust-mouth",2.16,.045,sx,topY+1.98,z,exhaustBlack,2.16,32);
      for(const dz of [-2.05,1.7]) {
        wallBox("funnel-intake-dark-recess",2.4,2.85,side,baseY+2.6,z+dz,layout,dark,.08);
        for(let y=baseY+1.54;y<=baseY+3.68;y+=.27)
          wallBox("funnel-intake-horizontal-slat",.10,2.63,side,y,z+dz,layout,gray,.12,.075);
      }
      for(const dz of [-2.6,0,2.6]) wallBox("funnel-upper-exhaust-service-panel",1.75,1.12,side,baseY+5.15,z+dz,layout,radar,.06);
      const surface=(y:number,dz:number)=>sideSurface(layout,side,y,z+dz).point.add(sideSurface(layout,side,y,z+dz).normal.scale(.1)).asArray();
      for(const dz of [-3.55,-3.0])tube("funnel-service-ladder",[surface(baseY+.6,dz),surface(topY+.1,dz)],.035,light);
      for(let y=baseY+.8;y<topY;y+=.36)tube("funnel-ladder-rung",[surface(y,-3.55),surface(y,-3)],.025,light);
    }
    cylinder("auxiliary-uptake-rim",1.45,.38,0,topY+.38,z+2.35,dark,1.45,20);
    cylinder("auxiliary-uptake-opening",1.21,.08,0,topY+.61,z+2.35,exhaustBlack,1.21,20);
    box("funnel-service-platform",10.6,.18,10.2,0,baseY+.14,z,deck);
    for(const side of [-1,1]) {
      tube("funnel-guardrail",[[side*5.1,baseY+1.3,z-4.6],[side*5.1,baseY+1.3,z+4.6]],.032,light);
      for(let dz=-4.6;dz<=4.6;dz+=1.53) tube("funnel-guardrail-post",[[side*5.1,baseY+.24,z+dz],[side*5.1,baseY+1.35,z+dz]],.032,light);
    }
  }
  // Aft 64-cell Mk 41 launch deck grid. The forward bank is detailed separately.
  const aftMissileLaunchCells: VlsLaunchCell[] = [];
  const vls=(z:number,rows:number,y:number)=>{
    box("Mk41-launcher-coaming",7.35,.42,rows*1.3+.55,0,y,z,dark);
    for(let row=0;row<rows;row++) for(let col=0;col<8;col++) {
      const x=(col-3.5)*.86,cellZ=z+(row-(rows-1)/2)*1.3;
      for(const side of [-1,1]) {
        box("VLS-cell-hatch-rim-side",.085,.13,1.18,x+side*.3525,y+.26,cellZ,radar);
        box("VLS-cell-hatch-rim-end",.62,.13,.09,x,y+.26,cellZ+side*.545,radar);
        box("VLS-hatch-hinge",.13,.07,.09,x+side*.18,y+.35,cellZ-.5,dark);
      }
      aftMissileLaunchCells.push(createVlsLaunchCell(scene,root,casters,{
        bank:"aft",index:row*8+col,x,y:y+.35,z:cellZ,width:.62,depth:1,thickness:.1,
      },{gray,light,dark}));
    }
  };
  vls(-30,8,12.05);

  const scanner=addDestroyerMast(scene,root,casters,{gray,light,deck,dark,radar,glass,white,orange:safetyOrange});
  for(const side of [-1,1]) for(const z of [15,-12.6,-35.5]) {
    const x=side*(z===-12.6?3.6:5.7), roof=z>0?roofHeight(DESTROYER_HOUSES.forward):z>-25?roofHeight(DESTROYER_HOUSES.aft):HANGAR_ROOF_Y;
    cylinder("tactical-communications-platform",2.5,.28,x,roof+.14,z,radar,2.5,16);
    cylinder("radome-mount-neck",.72,.48,x,roof+.51,z,gray);
    const ball=register(CreateSphere("satcom-radome",{diameter:1.8,segments:16},scene),white);
    ball.position.set(x,roof+1.5,z);
  }
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
    for(const z of [-67,-54,47,66]) {
      const x=side*(stationValue(z,1)-1.3);
      cylinder("bollard",.45,.85,x,deckHeight(z)+.415,z,dark);
    }
    for(let z=-47;z<=34;z+=1.8) {
      const y=deckHeight(z),x=side*(stationValue(z,1)-.2);
      tube("lifeline-stanchion",[[x,y,z],[x,y+1.12,z]],.032,light);
    }
    for(const height of [.55,1.15]) tube("deck-edge-lifeline",([[-47,stationValue(-47,1),0,stationValue(-47,3)],...stations.filter(s=>s[0]>=-42)] as [number,number,number,number][]).map(([z,b,,y])=>[side*(b-.15),y+height,z]),.025,light);
    const nav=paint(side<0?"port-red":"starboard-green",side<0?"#dd3024":"#35d87b");
    nav.emissiveColor=Color3.FromHexString(side<0?"#aa160c":"#0d8e38");
    box("navigation-light",.3,.35,.4,side*8.65,18.35,30,nav);
    // Twin shafts and rudders, visible from below the waterline.
    tube("propeller-shaft",[[side*3.7,-3.8,-52],[side*3.7,-4.2,-70]],.27,dark);

  }
  addDestroyerFlightDeck(scene,root,casters,{gray,light,deck,dark,radar,glass,white,orange:safetyOrange},deckHeight,z=>stationValue(z,1));
  const lettering=new DynamicTexture("hull-number",{width:512,height:256},scene,true);
  lettering.hasAlpha=true;
  const lc=lettering.getContext() as CanvasRenderingContext2D;lc.clearRect(0,0,512,256);lc.font="bold 214px Arial";lc.textAlign="center";
  lc.translate(256,0);lc.scale(1.8,1);lc.lineWidth=9;lc.strokeStyle="#3c494c";lc.strokeText("96",0,205);lc.fillStyle="#d0d4cf";lc.fillText("96",0,205);lettering.update();
  const number=paint("hull-number-paint","#ffffff");number.albedoTexture=lettering;number.useAlphaFromAlbedoTexture=true;
  for(const side of [-1,1]) {
    const plate=register(CreatePlane("bow-hull-number",{width:5.7,height:2.85,sideOrientation:Mesh.DOUBLESIDE},scene),number);
    const surface=hullSurface(side,4.05,57), up=Vector3.Up().subtract(surface.normal.scale(surface.normal.y)).normalize(), inward=surface.normal.negate();
    plate.rotationQuaternion=Quaternion.RotationQuaternionFromAxis(Vector3.Cross(up,inward).normalize(),up,inward);
    plate.position.copyFrom(surface.point.add(surface.normal.scale(.02)));
  }

  addDestroyerHouseFront(scene,root,casters,{gray,light,deck,dark,radar,glass,white,orange:safetyOrange},deckHeight);
  const foredeckGun: ForedeckGunControls = addDestroyerForedeck(scene,root,casters,{gray,light,dark,radar,white,orange:safetyOrange,red:deckRed,green:capstanGreen},deckHeight,z=>stationValue(z,1));
  addDestroyerReferenceFittings(scene,root,casters,{gray,light,deck,dark,radar,glass,white,orange:safetyOrange},deckHeight);
  const details=addDestroyerDetails(scene,root,casters,{gray,light,deck,dark,radar,glass,white,orange:safetyOrange},deckHeight,z=>stationValue(z,1),hullSurface);
  const missileLaunchCells=[...foredeckGun.missileLaunchCells,...aftMissileLaunchCells];
  const animatedParts=new Set([scanner,...details.animated,...foredeckGun.animatedMeshes,
    ...missileLaunchCells.flatMap(cell=>cell.hatchMeshes)]);
  // Preserve each vertex layout while batching static fittings by material.
  mergeStaticMeshes(root, casters, animatedParts);
  let previousTime=0;
  return {root,shadowCasters:casters,gunCameraMount:foredeckGun.cameraMount,missileLaunchCells,update(state,interpolation){
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
