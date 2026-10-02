import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { BoatSimulationState } from "@naval/shared";

import { DESTROYER_HOUSES, MAST_FOOT_Y, HANGAR_ROOF_Y, BOAT_DECK_Y, roofHeight, sideSurface, seatSurfaceBox, seatSurfaceCylinder } from "./destroyerMounts";
import type { DeckhouseLayout, MountSurface } from "./destroyerMounts";

type Paints = Record<"gray" | "light" | "deck" | "dark" | "radar" | "glass" | "white" | "orange", PBRMaterial>;

/** Small fittings from the supplied underway reference, batched by the caller. */
export function addDestroyerDetails(scene: Scene, root: Mesh, casters: Mesh[], paints: Paints,
  deckHeight: (z: number) => number, hullBeam: (z: number) => number,
  hullSurface: (side: number, y: number, z: number) => MountSurface,
): { animated: Mesh[]; update(state: BoatSimulationState, dt: number): void } {
  const { gray, light, deck, dark, radar, glass, white, orange } = paints;
  const register = (mesh: Mesh, material = gray) => {
    mesh.parent = root; mesh.material = material; mesh.isPickable = false;
    mesh.receiveShadows = true; casters.push(mesh); return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material = gray) => {
    const mesh = register(CreateBox(name, { width: w, height: h, depth: d }, scene), material);
    mesh.position.set(x, y, z); return mesh;
  };
  const cylinder = (name: string, d: number, h: number, x: number, y: number, z: number, material = gray) => {
    const mesh = register(CreateCylinder(name, { diameter: d, height: h, tessellation: 16 }, scene), material);
    mesh.position.set(x, y, z); return mesh;
  };
  const sphere = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, material = gray) => {
    const mesh = register(CreateSphere(name, { diameter: 1, segments: 8 }, scene), material);
    mesh.position.set(x, y, z); mesh.scaling.set(sx, sy, sz); return mesh;
  };
  const tube = (name: string, path: number[][], radius = .04, material = light) => register(CreateTube(name, {
    path: path.map(p => new Vector3(p[0], p[1], p[2])), radius, tessellation: 5, cap: Mesh.CAP_ALL,
  }, scene), material);
  const wallBox = (name: string, thickness: number, h: number, depth: number, side: number, y: number, z: number,
    layout: DeckhouseLayout, material = gray, offset = 0) => seatSurfaceBox(box(name, thickness, h, depth, 0, 0, 0, material),
      sideSurface(layout, side, y, z), thickness, offset);
  const railing = (name: string, x1: number, z1: number, x2: number, z2: number, y: number) => {
    for (const h of [.5, 1]) tube(name, [[x1, y + h, z1], [x2, y + h, z2]], .025);
    const count = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 1.6);
    for (let i = 0; i <= count; i++) { const t = i / count;
      tube(name + "-post", [[x1 + (x2 - x1) * t, y, z1 + (z2 - z1) * t],
        [x1 + (x2 - x1) * t, y + 1.08, z1 + (z2 - z1) * t]], .035);
    }
  };

  // Mooring bitts and chocks continue along both sides of the ship.
  for (const side of [-1, 1]) {
    const hawse = register(CreateTorus("bow-hawse-rim", { diameter: 1.05, thickness: .18, tessellation: 16 }, scene), radar);
    seatSurfaceCylinder(hawse, hullSurface(side, 4.4, 71), .18, .02);
    const anchor = (y: number, z: number) => {
      const surface = hullSurface(side, y, z);
      return surface.point.add(surface.normal.scale(.15)).asArray();
    };
    tube("anchor-shank", [anchor(4.4, 71), anchor(3.0, 71)], .14, dark);
    tube("anchor-flukes", [anchor(3.3, 70.2), anchor(2.9, 71), anchor(3.3, 71.8)], .16, dark);
    for (const z of [-71, -58, -12, 32, 58, 72]) {
      const y = deckHeight(z), bx = side * (hullBeam(z) - 1.05);
      box("double-bitt-footplate", 1.3, .14, 1.4, bx, y + .1, z, radar);
      for (const dz of [-.35, .35]) { cylinder("double-bitt", .32, .7, bx, y + .5, z + dz, dark);
        box("bitt-crosspiece", .85, .16, .23, bx, y + .74, z + dz, light); }
      box("chock-footplate", .8, .15, 1.7, side * (hullBeam(z) - .22), y + .15, z + 1.4, light);
      for (const dz of [-.52, .52]) box("chock-upright", .28, .47, .32, side * (hullBeam(z) - .22), y + .45, z + 1.4 + dz, light);
    }
  }
  cylinder("stern-ensign-staff", .09, 5.6, 0, deckHeight(-76.7)+2.79, -76.7, light);

  // Wrapped walkways, expansion joints, access ladders and bridge fittings.
  for (const side of [-1, 1]) {
    railing("bridge-wing-rail", side * 6.3, 32.4, side * 8.4, 32.4, 18.2);
    railing("bridge-wing-rail", side * 8.4, 25.8, side * 8.4, 32.4, 18.2);
    cylinder("bridge-pelorus", .44, .9, side * 7.8, 18.68, 30.8, light);
    cylinder("bridge-searchlight-stand", .22, 1.2, side * 7.9, 18.84, 27.0, light);
    sphere("bridge-searchlight", side * 7.9, 19.6, 27.0, .62, .58, .75, light);
    box("searchlight-lens", .42, .36, .04, side * 7.9, 19.6, 27.375, glass);
    for (const z of [-41, -33, -16, 7, 17, 26]) {
      const layout=z>0?DESTROYER_HOUSES.forward:z>-25?DESTROYER_HOUSES.aft:DESTROYER_HOUSES.hangar;
      const y=z>0?10.8:8.9;
      wallBox("watertight-door-frame",.15,2.3,1.15,side,y,z,layout,light);
      wallBox("watertight-door",.18,1.99,.89,side,y,z,layout,gray,.11);
      for (const dy of [-.64,.64]) wallBox("door-dog-handle",.22,.1,.25,side,y+dy,z+.3,layout,dark,.22);
      const pipe=(y:number)=>{const s=sideSurface(layout,side,y,z-1);return s.point.add(s.normal.scale(.06)).asArray();};
      tube("fire-main-pipe",[pipe(y-1),pipe(y-.1)],.045,light);
      const reel=register(CreateTorus("fire-hose-reel",{diameter:.65,thickness:.17,tessellation:12},scene),orange);
      seatSurfaceCylinder(reel,sideSurface(layout,side,y-.25,z-1),.17,.035);
    }
    // Canisters and electronics sit on their own deck, inside its perimeter.
    for (const z of [-28, -25.5, 1, 4, 7]) {
      const x=side*6.0, roof=z>0?roofHeight(DESTROYER_HOUSES.forward):HANGAR_ROOF_Y, y=roof+.22;
      for(const dx of [-.65,.65]) box("liferaft-rack-leg",.12,.35,.9,x+dx,roof+.16,z,gray);
      box("liferaft-cradle",1.9,.22,1.2,x,y,z,radar);
      const raft=cylinder("canister-liferaft",.94,1.65,x,y+.56,z,white);raft.rotation.z=Math.PI/2;
      for (const dx of [-.46,.46]) {const strap=register(CreateTorus("liferaft-retaining-band",{diameter:.99,thickness:.04,tessellation:12},scene),dark);
        strap.position.set(x+dx,y+.56,z);strap.rotation.z=Math.PI/2;}
    }
    for (const z of [-15.2,10]) {
      const roof=roofHeight(z>0?DESTROYER_HOUSES.forward:DESTROYER_HOUSES.aft)+(z<0?.12:0), x=side*(z>0?6.0:5.9);
      if(z<0){
        box("electronic-warfare-support-gallery",2.3,.2,3.1,side*5.8,roof-.1,z,deck);
        for(const dz of [-1.1,1.1]){
          const anchor=sideSurface(DESTROYER_HOUSES.aft,side,8.9,z+dz).point;
          tube("electronic-gallery-support",[anchor.asArray(),[side*6.8,roof-.2,z+dz]],.10,gray);
        }
      }
      box("SLQ32-electronic-warfare-pedestal",2.0,1.0,2.7,x,roof+.49,z,gray);
      box("SLQ32-array",2.4,1.6,2.9,x,roof+1.75,z,radar);
      for(let i=0;i<5;i++)box("electronic-array-fin",.12,1.75,3,x+(i-2)*.42,roof+1.75,z,gray);
    }
    const torpedoX=side*3.5, torpedoZ=-5.5;
    cylinder("torpedo-mount-foot",1.0,1.1,torpedoX,BOAT_DECK_Y+.54,torpedoZ,radar);
    box("torpedo-mount-bracket",1.35,.25,2.2,torpedoX,BOAT_DECK_Y+1.17,torpedoZ,gray);
    // Three tubes form a compact triangular cluster on one training cradle.
    const direction=new Vector3(side*.55,0,.835).normalize(), across=new Vector3(side*.835,0,-.55).normalize();
    for(const [offset,dy] of [[-.30,0],[.30,0],[0,.52]]) {
      const center=new Vector3(torpedoX,BOAT_DECK_Y+1.55+dy,torpedoZ).add(across.scale(offset));
      const mount=cylinder("Mk32-triple-torpedo-tube",.55,3.8,center.x,center.y,center.z,light);
      mount.rotationQuaternion=Quaternion.RotationQuaternionFromAxis(across,direction,Vector3.Cross(across,direction).normalize());
      const tip=center.add(direction.scale(1.93));
      const cap=cylinder("Mk32-torpedo-tube-end",.58,.09,tip.x,tip.y,tip.z,radar);
      cap.rotationQuaternion=mount.rotationQuaternion.clone();
      for(const distance of [-1.15,1.15]) {
        const p=center.add(direction.scale(distance)),band=register(CreateTorus("Mk32-torpedo-retaining-band",{diameter:.58,thickness:.045,tessellation:12},scene),gray);
        band.position.copyFrom(p);band.rotationQuaternion=mount.rotationQuaternion.clone();
      }
    }
    for(const z of [12,-44]){
      const roof=z>0?roofHeight(DESTROYER_HOUSES.forward):HANGAR_ROOF_Y, x=side*(z>0?6.4:5.8);
      box("decoy-launcher-base",1.5,.65,1.8,x,roof+.315,z,dark);
      for(let i=0;i<6;i++){
        const launcher=cylinder("decoy-launch-tube",.19,.8,x+side*(i%2*.25),roof+.92,z+(Math.floor(i/2)-1)*.35,light);
        launcher.rotation.z=side*.5;
      }
    }
    for(const z of [-39,-34,-29]){
      wallBox("hangar-intake",.15,2.9,3.6,side,9.1,z,DESTROYER_HOUSES.hangar,radar);
      for(let y=7.85;y<10.6;y+=.26)wallBox("hangar-intake-louver",.19,.075,3.3,side,y,z,DESTROYER_HOUSES.hangar,light,.12);
    }

  }

  for (const [x, z, roof] of [[0, 23.5, MAST_FOOT_Y], [-3.0, -37, HANGAR_ROOF_Y], [3.0, -37, HANGAR_ROOF_Y]]) {
    const y=roof+.61;
    cylinder("SPG62-illuminator-pedestal", 1.0, 1.25, x, y, z, gray);
    const dish = sphere("SPG62-radar-dish", x, y + 1.15, z, 2.1, 1.9, .32, light);
    dish.rotation.x = -.25;
    tube("illuminator-feed-arm", [[x, y + 1.15, z + .25], [x, y + 1.15, z + 1.2]], .09, gray);
    sphere("illuminator-feed", x, y + 1.15, z + 1.2, .4, .4, .3, radar);
  }
  for (const side of [-1, 1]) {
    cylinder("aft-whip-antenna", .075, 7.5, side * 5.1, HANGAR_ROOF_Y+4.43, -42, gray);
    cylinder("aft-antenna-foot", .5, .7, side * 5.1, HANGAR_ROOF_Y+.34, -42, light);
  }

  const flagTexture=new DynamicTexture("underway-ensign",{width:512,height:256},scene,true);
  const flagCanvas=flagTexture.getContext();
  for(let row=0;row<13;row++){flagCanvas.fillStyle=row%2?"#ebe8dc":"#a94143";flagCanvas.fillRect(0,row*256/13,512,256/13+1);}
  flagCanvas.fillStyle="#334f78";flagCanvas.fillRect(0,0,214,138);
  flagCanvas.fillStyle="#e4e7df";for(let row=0;row<9;row++)for(let col=0;col<(row%2?5:6);col++){flagCanvas.beginPath();flagCanvas.arc(18+col*35+(row%2?17:0),12+row*14,2.7,0,Math.PI*2);flagCanvas.fill();}flagTexture.update();
  const flagPaint=white.clone("ensign-fabric")!;flagPaint.albedoTexture=flagTexture;flagPaint.backFaceCulling=false;flagPaint.twoSidedLighting=true;flagPaint.roughness=.97;flagPaint.metallic=0;
  tube("ensign-hoist-line",[[-1.45,31.1,20.38],[-1.45,35.9,20.38]],.015,dark);
  const flag=register(new Mesh("wind-driven-underway-ensign",scene),flagPaint);flag.position.set(-1.45,31.25,20.38);
  const flagPositions=new Float32Array(12*2*3),flagUvs:number[]=[],flagIndices:number[]=[];
  for(let i=0;i<12;i++){for(let j=0;j<2;j++){const index=(i*2+j)*3;flagPositions[index]=-i/11*6.6;flagPositions[index+1]=j?0:3.5;flagPositions[index+2]=-i/11*3.1;flagUvs.push(i/11,j?0:1);}if(i<11){const a=i*2;flagIndices.push(a,a+1,a+2,a+1,a+3,a+2);}}
  const flagNormals:number[]=[];VertexData.ComputeNormals(flagPositions,flagIndices,flagNormals);
  const flagData=new VertexData();flagData.positions=flagPositions;flagData.indices=flagIndices;flagData.normals=flagNormals;flagData.uvs=flagUvs;flagData.applyToMesh(flag,true);
  const animated: Mesh[] = [flag], rudders: Mesh[] = [], props: Mesh[] = [];
  for (const side of [-1, 1]) {
    const blades: Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      const blade = sphere("five-blade-propeller", Math.cos(a) * 1.18, Math.sin(a) * 1.18, 0, .7, 2.4, .17, radar);
      blade.rotation.z = a - Math.PI / 2; blade.rotation.y = .3; blades.push(blade);
    }
    const hub = cylinder("propeller-hub", .64, .9, 0, 0, 0, radar); hub.rotation.x = Math.PI / 2; blades.push(hub);
    const prop = Mesh.MergeMeshes(blades, true, true)!;
    for (const blade of blades) casters.splice(casters.indexOf(blade), 1);
    prop.parent = root; prop.position.set(side * 3.7, -4.15, -69.2); prop.material = radar; prop.isPickable = false;
    props.push(prop); animated.push(prop); casters.push(prop);
    const rudder = box("working-spade-rudder", .35, 2.8, 3.1, side * 3.7, -3.5, -73, gray);
    rudders.push(rudder); animated.push(rudder);
  }
  return { animated, update(state, dt) {
    for(let i=0;i<12;i++)for(let j=0;j<2;j++){const t=i/11,index=(i*2+j)*3;
      const flutter=Math.sin(t*9-state.elapsedTime*(3+state.speed*.08)+j*.4)*t*.42;
      flagPositions[index]=-t*6.6+flutter*.425;
      flagPositions[index+2]=-t*3.1-flutter*.906;
      flagPositions[index+1]=(j?0:3.5)-t*.72+Math.sin(t*8-state.elapsedTime*3.3)*t*.11;
    }
    flag.updateVerticesData("position",flagPositions,false,false);
    VertexData.ComputeNormals(flagPositions,flagIndices,flagNormals);flag.updateVerticesData("normal",flagNormals,false,false);
    for (let i = 0; i < props.length; i++) props[i].rotation.z += (i === 0 ? 1 : -1) * state.throttle * 9.5 * dt;
    for (const rudder of rudders) rudder.rotation.y = -state.rudderAngleRadians;
  } };
}

/** Chamfered, slightly sloping faces rather than a rectangular bridge block. */
export function createFacetedDeckhouse(name: string, width: number, depth: number, height: number,
  chamfer: number, inset: number, scene: Scene): Mesh {
  const w = width / 2, d = depth / 2;
  const ring = [[-w, -d + chamfer], [-w + chamfer, -d], [w - chamfer, -d], [w, -d + chamfer],
    [w, d - chamfer], [w - chamfer, d], [-w + chamfer, d], [-w, d - chamfer]];
  const positions: number[] = [], indices: number[] = [];
  for (const y of [0, height]) for (const [x, z] of ring) positions.push(x - Math.sign(x) * (y ? inset : 0), y, z - Math.sign(z) * (y ? inset : 0));
  for (let i = 0; i < 8; i++) { const n = (i + 1) % 8; indices.push(i, n, i + 8, n, n + 8, i + 8); }
  for (let i = 1; i < 7; i++) indices.push(8, 8 + i, 9 + i, 0, i + 1, i);
  const normals: number[] = []; VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = normals;
  data.uvs = positions.flatMap((_, i) => i % 3 === 0 ? [positions[i] / width + .5, positions[i + 1] / height] : []);
  const mesh = new Mesh(name, scene); data.applyToMesh(mesh); mesh.convertToFlatShadedMesh(); return mesh;
}

export function createDeckSurfaceTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture("weathered-nonskid", { width: 512, height: 2048 }, scene, true);
  const context = texture.getContext(); context.fillStyle = "#646b6d"; context.fillRect(0, 0, 512, 2048);
  let seed = 431; const random = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 65000; i++) { const v = 78 + Math.floor(random() * 70);
    context.fillStyle = `rgba(${v},${v + 3},${v + 3},.22)`; context.fillRect(random() * 512, random() * 2048, 1.5, 1.5); }
  context.strokeStyle = "rgba(34,43,46,.19)"; context.lineWidth = 1;
  for (let z = 0; z < 2048; z += 86) { context.beginPath(); context.moveTo(0, z); context.lineTo(512, z); context.stroke(); }
  texture.update(); texture.anisotropicFilteringLevel = 8; return texture;
}
