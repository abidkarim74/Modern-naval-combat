import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
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

  // Forecastle anchor windlasses, wildcats, chain beds and cable fairleads.
  for (const side of [-1, 1]) {
    const x = side * 1.65;
    box("anchor-chain-bed", 1.5, .10, 8.2, x, deckHeight(69) + .08, 69, dark);
    cylinder("anchor-windlass-base", 1.45, .28, x, deckHeight(65) + .18, 65, light);
    cylinder("anchor-wildcat", .95, .6, x, deckHeight(65) + .56, 65, dark);
    cylinder("anchor-capstan-head", .8, .35, x, deckHeight(65) + 1.0, 65, light);
    for (let i = 0; i < 25; i++) {
      const z = 65.3 + i * .31;
      const link = register(CreateTorus("anchor-chain-link", { diameter: .30, thickness: .075, tessellation: 8 }, scene), dark);
      link.position.set(x, deckHeight(z) + .15, z); link.scaling.z = 1.55;
      if (i % 2) link.rotation.z = Math.PI / 2;
    }
    const hawse = register(CreateTorus("bow-hawse-rim", { diameter: 1.05, thickness: .18, tessellation: 16 }, scene), radar);
    const hawseSurface=hullSurface(side,4.4,71);
    seatSurfaceCylinder(hawse,hawseSurface,.18,.02);
    const anchor=(y:number,z:number)=>{const s=hullSurface(side,y,z);return s.point.add(s.normal.scale(.15)).asArray();};
    tube("anchor-shank", [anchor(4.4,71),anchor(3.0,71)], .14, dark);
    tube("anchor-flukes", [anchor(3.3,70.2),anchor(2.9,71),anchor(3.3,71.8)], .16, dark);
    for (const z of [-71, -58, -12, 32, 58, 72]) {
      const y = deckHeight(z), bx = side * (hullBeam(z) - 1.05);
      box("double-bitt-footplate", 1.3, .14, 1.4, bx, y + .1, z, radar);
      for (const dz of [-.35, .35]) { cylinder("double-bitt", .32, .7, bx, y + .5, z + dz, dark);
        box("bitt-crosspiece", .85, .16, .23, bx, y + .74, z + dz, light); }
      box("chock-footplate", .8, .15, 1.7, side * (hullBeam(z) - .22), y + .15, z + 1.4, light);
      for (const dz of [-.52, .52]) box("chock-upright", .28, .47, .32, side * (hullBeam(z) - .22), y + .45, z + 1.4 + dz, light);
    }
  }
  cylinder("forecastle-jackstaff", .075, 3.4, 0, 8.6, 76.5, light);
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
    sphere("RHIB-port-inflatable-tube", side * 7 - .72, 7.5, -6, .48, .55, 6.4, dark);
    sphere("RHIB-starboard-inflatable-tube", side * 7 + .72, 7.5, -6, .48, .55, 6.4, dark);
    box("RHIB-console", .65, 1.1, .65, side * 7, 7.8, -5.2, light);
    box("RHIB-windscreen", .65, .42, .06, side * 7, 8.4, -4.88, glass);
    box("RHIB-outboard", .5, .85, .5, side * 7, 7.15, -9.4, dark);
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
    const torpedoX=side*4.7, torpedoZ=-7;
    cylinder("torpedo-mount-foot",1.0,1.1,torpedoX,BOAT_DECK_Y+.54,torpedoZ,radar);
    box("torpedo-mount-bracket",1.35,.25,2.2,torpedoX,BOAT_DECK_Y+1.17,torpedoZ,gray);
    for(let row=0;row<3;row++){
      const mount=cylinder("Mk32-triple-torpedo-tube",.55,3.8,torpedoX,BOAT_DECK_Y+1.55+row*.53,torpedoZ,light);
      mount.rotation.x=Math.PI/2;
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
    // Open safety nets outside the landing area.
    for (let z = -74; z < -49; z += 4.2) {
      tube("flight-deck-safety-net-frame", [[side * hullBeam(z), deckHeight(z) + .05, z], [side * (hullBeam(z) + 1.3), deckHeight(z) - .45, z],
        [side * (hullBeam(z + 3.9) + 1.3), deckHeight(z + 3.9) - .45, z + 3.9]], .035, gray);
      for (let j = 1; j < 4; j++) tube("flight-deck-net", [[side * (hullBeam(z) + j * .3), deckHeight(z) - j * .1, z],
        [side * (hullBeam(z + 3.9) + j * .3), deckHeight(z + 3.9) - j * .1, z + 3.9]], .012, radar);
    }
  }

  // Mast platforms, ladder, antenna trunks, cross braces and standing rigging.
  for (const [y, width, depth] of [[27.6, 7.4, 4.2], [32.2, 9.6, 4.5], [35.7, 6.4, 3.0]]) {
    box("mast-grated-platform", width, .16, depth, 0, y, 20, deck);
    railing("mast-platform-lifeline", -width / 2, 20 - depth / 2, width / 2, 20 - depth / 2, y);
    railing("mast-platform-lifeline", -width / 2, 20 + depth / 2, width / 2, 20 + depth / 2, y);
    for (const side of [-1, 1]) { railing("mast-platform-lifeline", side * width / 2, 20 - depth / 2, side * width / 2, 20 + depth / 2, y);
      tube("mast-diagonal-brace", [[side * 1.4, y - 3, 20], [side * width / 2, y, 20]], .10, light); }
  }
  for (const side of [-1, 1]) {
    tube("mast-stay", [[side * 5.8, 21.77, 28], [0, 36.5, 20]], .018, dark);
    tube("signal-halyard", [[side * 4.2, 35.7, 20], [side * 5.2, MAST_FOOT_Y+.025, 23]], .012, dark);
    for (let i = 0; i < 7; i++) {const height=2.4+i%3;
      cylinder("mast-whip-array",.065,height,side*(1.0+i*.48),32.28+height/2-.01,19.4,gray);
    }
  }
  tube("mast-ladder-rail", [[.62, MAST_FOOT_Y, 18.08], [.35, 36.5, 19.15]], .035, light);
  tube("mast-ladder-rail", [[1.19, MAST_FOOT_Y, 18.08], [.92, 36.5, 19.15]], .035, light);
  for(let y=MAST_FOOT_Y+.3;y<36.3;y+=.38){const t=(y-MAST_FOOT_Y)/(36.5-MAST_FOOT_Y);
    tube("mast-ladder-rung",[[.62-.27*t,y,18.08+1.07*t],[1.19-.27*t,y,18.08+1.07*t]],.023,light);
  }
  for(const y of [20,24,28,32,35])tube("mast-ladder-standoff",[[.6,y,20],[.6,y,18.08+1.07*(y-MAST_FOOT_Y)/(36.5-MAST_FOOT_Y)]],.045,gray);
  cylinder("mast-top-sensor-pedestal", .9, 1.4, 0, 39.4, 20, gray);
  sphere("mast-top-radome", 0, 40.35, 20, 1.7, 1.55, 1.7, white);
  cylinder("mast-top-antenna", .07, 2.8, 0, 42.0, 20, light);
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

  // Forecastle helicopter/UNREP square and gun training arc, visible in the photo.
  const foreTexture = new DynamicTexture("forecastle-operating-markings", { width: 512, height: 512 }, scene, true);
  foreTexture.hasAlpha = true; const fc = foreTexture.getContext();
  fc.strokeStyle = "rgba(235,235,218,.85)"; fc.lineWidth = 5; fc.strokeRect(100, 150, 310, 240);
  fc.beginPath(); fc.moveTo(256, 50); fc.lineTo(256, 470); fc.moveTo(30, 270); fc.lineTo(480, 270); fc.stroke();
  fc.strokeStyle = "rgba(221,172,139,.7)"; fc.lineWidth = 3; fc.setLineDash([12, 12]);
  fc.beginPath(); fc.arc(256, 220, 186, .25, Math.PI * 1.93); fc.stroke(); foreTexture.update();
  const marking = white.clone("forecastle-deck-paint")!; marking.albedoTexture = foreTexture; marking.useAlphaFromAlbedoTexture = true;
  const plane = register(CreatePlane("forecastle-operating-square", { width: 7.8, height: 12, sideOrientation: Mesh.DOUBLESIDE }, scene), marking);
  plane.rotation.x = Math.PI / 2; plane.rotation.y = Math.PI; plane.position.set(0, deckHeight(61) + .045, 61);
  plane.rotation.x -= .034;

  // A parked folded-rotor Seahawk gives the aft working deck its proper scale.
  const hx = 3.0, hz = -62, hy = deckHeight(hz);
  sphere("Seahawk-fuselage", hx, hy + 1.55, hz, 2.05, 2.2, 5.8, gray);
  sphere("Seahawk-cockpit", hx, hy + 1.9, hz + 2.05, 1.8, 1.5, 1.6, glass);
  box("Seahawk-windscreen-divider", .1, 1.4, 1.8, hx, hy + 2.0, hz + 2.12, gray);
  tube("Seahawk-tail-boom", [[hx, hy + 1.5, hz - 2], [hx, hy + 1.8, hz - 7.1]], .35, gray);
  const fin = box("Seahawk-tail-fin", .15, 2.2, 1.35, hx, hy + 2.5, hz - 7.2, gray); fin.rotation.x = -.24;
  box("Seahawk-tail-stabilizer", 3.1, .13, .9, hx, hy + 1.6, hz - 6, gray);
  for (const side of [-1, 1]) {
    sphere("Seahawk-engine-nacelle", hx + side * .67, hy + 2.85, hz - .7, .65, .72, 2.3, gray);
    tube("Seahawk-main-gear", [[hx + side * .7, hy + 1.0, hz + .3], [hx + side * 1.1, hy + .4, hz + .3]], .11, dark);
    const tire = cylinder("Seahawk-main-wheel", .64, .18, hx + side * 1.1, hy + .32, hz + .3, dark); tire.rotation.z = Math.PI / 2;
    box("Seahawk-cabin-door", .035, 1.2, 1.5, hx + side * 1.025, hy + 1.4, hz - .35, radar);
    box("Seahawk-cabin-window", .045, .55, .75, hx + side * 1.05, hy + 1.9, hz - .35, glass);
  }
  cylinder("Seahawk-rotor-mast", .24, .8, hx, hy + 3.5, hz - .1, dark);
  for (const x of [-.54, -.18, .18, .54]) box("Seahawk-folded-main-blade", .25, .055, 6.0, hx + x, hy + 3.9, hz - 3.0, dark);
  tube("Seahawk-tail-gear", [[hx, hy + 1.3, hz - 5.3], [hx, hy + .3, hz - 5.3]], .08, gray);
  const tailTire = cylinder("Seahawk-tail-wheel", .38, .15, hx, hy + .19, hz - 5.3, dark); tailTire.rotation.z = Math.PI / 2;
  for (const side of [-1, 1]) tube("Seahawk-tie-down-chain", [[hx + side * 1.0, hy + .5, hz + .3], [hx + side * 2.0, hy + .1, hz + 1.1]], .025, radar);

  const flagTexture=new DynamicTexture("underway-ensign",{width:512,height:256},scene,true);
  const flagCanvas=flagTexture.getContext();
  for(let row=0;row<13;row++){flagCanvas.fillStyle=row%2?"#ebe8dc":"#a94143";flagCanvas.fillRect(0,row*256/13,512,256/13+1);}
  flagCanvas.fillStyle="#334f78";flagCanvas.fillRect(0,0,214,138);
  flagCanvas.fillStyle="#e4e7df";for(let row=0;row<9;row++)for(let col=0;col<(row%2?5:6);col++){flagCanvas.beginPath();flagCanvas.arc(18+col*35+(row%2?17:0),12+row*14,2.7,0,Math.PI*2);flagCanvas.fill();}flagTexture.update();
  const flagPaint=white.clone("ensign-fabric")!;flagPaint.albedoTexture=flagTexture;flagPaint.backFaceCulling=false;flagPaint.twoSidedLighting=true;
  tube("ensign-hoist-line",[[.8,31,20],[.8,35.7,20]],.02,dark);
  const flag=register(new Mesh("wind-driven-underway-ensign",scene),flagPaint);flag.position.set(.8,31.9,20);
  const flagPositions=new Float32Array(12*2*3),flagUvs:number[]=[],flagIndices:number[]=[];
  for(let i=0;i<12;i++){for(let j=0;j<2;j++){const index=(i*2+j)*3;flagPositions[index+1]=j?0:2.5;flagPositions[index+2]=-i/11*4.8;flagUvs.push(i/11,j?0:1);}if(i<11){const a=i*2;flagIndices.push(a,a+1,a+2,a+1,a+3,a+2);}}
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
      flagPositions[index]=Math.sin(t*9-state.elapsedTime*(3+state.speed*.08)+j*.4)*t*.42;
      flagPositions[index+1]=(j?0:2.5)-t*.28+Math.sin(t*8-state.elapsedTime*3.3)*t*.11;
    }
    flag.updateVerticesData("position",flagPositions,false,false);
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
