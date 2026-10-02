import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { BOAT_DECK_Y, DESTROYER_HOUSES, seatSurfaceBox } from "./destroyerMounts";
import type { MountSurface } from "./destroyerMounts";

type Paints = Record<"gray" | "light" | "deck" | "dark" | "radar" | "glass" | "white" | "orange", PBRMaterial>;

/** Deck-scale working fittings interpreted from the user's public ship photographs.
 * Everything is static and joins the caller's material batches. Bow is +Z.
 */
export function addDestroyerReferenceFittings(scene: Scene, root: Mesh, casters: Mesh[], paints: Paints,
  deckHeight: (z: number) => number): void {
  const { gray, light, deck, dark, radar, glass, white, orange } = paints;
  const register = (mesh: Mesh, material = gray) => {
    mesh.parent = root; mesh.material = material; mesh.isPickable = false;
    mesh.receiveShadows = true; casters.push(mesh); return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material = gray) => {
    const mesh = register(CreateBox(name, { width: w, height: h, depth: d }, scene), material);
    mesh.position.set(x, y, z); return mesh;
  };
  const cylinder = (name: string, d: number, h: number, x: number, y: number, z: number, material = gray, top = d, segments = 12) => {
    const mesh = register(CreateCylinder(name, { diameterBottom: d, diameterTop: top, height: h, tessellation: segments }, scene), material);
    mesh.position.set(x, y, z); return mesh;
  };
  const sphere = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, material = white) => {
    const mesh = register(CreateSphere(name, { diameter: 1, segments: 10 }, scene), material);
    mesh.position.set(x, y, z); mesh.scaling.set(sx, sy, sz); return mesh;
  };
  const tube = (name: string, path: number[][], r: number, material = light, segments = 6) =>
    register(CreateTube(name, { path: path.map(p => Vector3.FromArray(p)), radius: r, tessellation: segments, cap: Mesh.CAP_ALL }, scene), material);
  const torus = (name: string, diameter: number, thickness: number, x: number, y: number, z: number, material = light) => {
    const mesh = register(CreateTorus(name, { diameter, thickness, tessellation: 16 }, scene), material);
    mesh.position.set(x, y, z); return mesh;
  };
  const custom = (name: string, positions: number[], indices: number[], material = gray) => {
    const normals: number[] = []; VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = normals;
    data.uvs = positions.flatMap((_, i) => i % 3 === 0 ? [positions[i] / 3 + .5, positions[i + 2] / 8 + .5] : []);
    const mesh = register(new Mesh(name, scene), material); data.applyToMesh(mesh); return mesh;
  };

  // Rigid hulls have a chine, keel and narrowing bows; the inflatable collars
  // follow that outline, rather than stretching spheres through the boat deck.
  for (const side of [-1, 1]) {
    const bx = side * 6.15, bz = -6.15, by = 6.10;
    const stations = [[-3.45,.80],[-3.05,.97],[-1.75,1.04],[.70,1.01],[2.30,.83],[3.10,.47],[3.58,.035]];
    const positions: number[] = [], indices: number[] = [];
    for (const [z, w] of stations) {
      const rise = Math.max(0, z - 1.5) * .13;
      for (const [x, y] of [[-w*.70,.54],[-w*.62,-.04],[0,-.20],[w*.62,-.04],[w*.70,.54]])
        positions.push(bx+x, by+y+rise, bz+z);
    }
    for(let station=0;station<stations.length-1;station++) for(let edge=0;edge<4;edge++) {
      const a=station*5+edge,b=a+1,c=a+5,d=b+5;
      indices.push(a,c,b,b,c,d);
    }
    // The stern transom has a flush engine recess and the bow closes at its stem.
    indices.push(0,1,4,1,3,4,1,2,3,30,34,31,31,34,33,31,33,32);
    custom("reference-RHIB-chined-hull", positions, indices, light).convertToFlatShadedMesh();
    box("RHIB-interior-nonskid-floor", 1.35, .12, 5.2, bx, by+.27, bz-.24, deck);
    for(const edge of [-1,1]) {
      const collar = stations.map(([z,w]) => [bx+edge*w*.81,by+.58+Math.max(0,z-1.5)*.13,bz+z]);
      tube("RHIB-inflatable-sponson", collar, .26, dark, 10);
      tube("RHIB-collar-rubbing-strake", collar.map(([x,y,z])=>[x+edge*.20,y-.04,z]), .037, radar);
      for(const z of [-2.6,-1.1,.45,1.85]) {
        const nearest=stations.reduce((a,b)=>Math.abs(b[0]-z)<Math.abs(a[0]-z)?b:a);
        tube("RHIB-grab-line",[[bx+edge*(nearest[1]*.81+.21),by+.69,bz+z-.28],
          [bx+edge*(nearest[1]*.81+.24),by+.66,bz+z+.28]],.025,light);
      }
    }
    tube("RHIB-rounded-stern-collar", [[bx-.65,by+.58,bz-3.45],[bx-.2,by+.58,bz-3.55],
      [bx+.2,by+.58,bz-3.55],[bx+.65,by+.58,bz-3.45]],.24,dark,10);
    box("RHIB-stern-transom-cap",1.18,.10,.18,bx,by+.54,bz-3.36,gray);
    // The compact helm includes an inclined screen and its own supporting rail.
    box("RHIB-steering-console",.66,.88,.70,bx,by+.74,bz+.62,light);
    const screen=box("RHIB-windscreen",.65,.39,.065,bx,by+1.39,bz+.95,glass);screen.rotation.x=-.18;
    tube("RHIB-windscreen-frame",[[bx-.35,by+1.19,bz+.92],[bx-.35,by+1.60,bz+1.0],
      [bx+.35,by+1.60,bz+1.0],[bx+.35,by+1.19,bz+.92]],.032,gray);
    const wheel=torus("RHIB-helm-wheel",.29,.029,bx,by+1.11,bz+.18,dark);wheel.rotation.x=Math.PI/2;
    tube("RHIB-helm-shaft",[[bx,by+1.1,bz+.15],[bx,by+.95,bz+.37]],.027,radar);
    box("RHIB-helm-instrument-panel",.44,.18,.035,bx,by+1.05,bz+.25,radar);
    for(const [x,z] of [[bx,bz-.12],[bx-.33,bz-1.1],[bx+.33,bz-1.1]]) {
      cylinder("RHIB-seat-pedestal",.13,.49,x,by+.52,z,gray,.13,8);
      box("RHIB-jockey-seat",.36,.20,.52,x,by+.88,z,dark);
      box("RHIB-seat-back",.36,.44,.10,x,by+1.06,z-.28,gray);
    }
    // Motor with a cowl, transom bracket, submerged leg and small propeller.
    sphere("RHIB-outboard-cowl",bx,by+.53,bz-3.77,.64,.78,.57,dark);
    box("RHIB-engine-transom-bracket",.38,.36,.60,bx,by+.35,bz-3.42,gray);
    box("RHIB-outboard-leg",.17,.63,.21,bx,by-.02,bz-3.74,radar);
    tube("RHIB-outboard-prop-shaft",[[bx,by-.33,bz-3.76],[bx,by-.33,bz-3.99]],.08,dark);
    const prop=box("RHIB-outboard-propeller",.41,.10,.07,bx,by-.33,bz-4.0,dark);prop.rotation.z=.6;
    tube("RHIB-stern-safety-frame",[[bx-.47,by+.43,bz-2.84],[bx-.47,by+1.80,bz-2.84],
      [bx+.47,by+1.80,bz-2.84],[bx+.47,by+.43,bz-2.84]],.045,light);
    cylinder("RHIB-radio-whip",.025,.91,bx+.45,by+2.22,bz-2.84,gray,.025,6);
    sphere("RHIB-stern-navigation-lamp",bx-.45,by+1.87,bz-2.84,.13,.13,.13,white);
    box("RHIB-orange-rescue-kit",.43,.21,.44,bx,by+.45,bz+2.26,orange);
    tube("RHIB-bow-painter",[[bx,by+.75,bz+3.3],[bx-.17,by+.44,bz+2.72],[bx+.20,by+.44,bz+2.20]],.028,light);

    // Steel saddles contact the keel. Footplates sit on the modeled open deck.
    for(const dz of [-2.0,1.30]) {
      for(const dx of [-.55,.55]) {
        box("RHIB-cradle-footplate",.45,.10,.53,bx+dx,BOAT_DECK_Y+.045,bz+dz,gray);
        tube("RHIB-cradle-angled-leg",[[bx+dx,BOAT_DECK_Y+.08,bz+dz],
          [bx+Math.sign(dx)*.23,by-.16,bz+dz]],.095,gray);
      }
      tube("RHIB-cradle-keel-saddle",[[bx-.66,by+.10,bz+dz],[bx-.25,by-.18,bz+dz],
        [bx+.25,by-.18,bz+dz],[bx+.66,by+.10,bz+dz]],.08,radar);
      tube("RHIB-securing-strap",[[bx-.71,by+.62,bz+dz],[bx-.83,BOAT_DECK_Y+.14,bz+dz],
        [bx+.83,BOAT_DECK_Y+.14,bz+dz],[bx+.71,by+.62,bz+dz]],.021,dark);
    }
    // A slewing pedestal, curved arm, hinge and hydraulic cylinder read clearly
    // from the broadside. The slack cable ends on the boat's lifting frame.
    const davitX=side*4.85, davitZ=-9.45;
    cylinder("RHIB-davit-deck-pedestal",.90,.57,davitX,BOAT_DECK_Y+.28,davitZ,gray);
    cylinder("RHIB-davit-slewing-ring",1.02,.13,davitX,BOAT_DECK_Y+.63,davitZ,radar);
    tube("RHIB-davit-curved-arm",[[davitX,BOAT_DECK_Y+.64,davitZ],[davitX,7.50,davitZ],
      [side*5.15,9.16,davitZ+.15],[side*5.55,9.60,davitZ+.70],
      [bx,9.73,bz-2.84]],.145,light,8);
    const hinge=cylinder("RHIB-davit-boom-hinge",.41,.38,davitX,7.52,davitZ,radar);hinge.rotation.x=Math.PI/2;
    tube("RHIB-davit-hydraulic-cylinder",[[davitX,6.68,davitZ+.07],[side*5.23,8.49,davitZ+.34]],.10,gray);
    tube("RHIB-davit-hydraulic-piston",[[side*5.23,8.49,davitZ+.34],[side*5.51,9.32,davitZ+.58]],.053,radar);
    tube("RHIB-davit-hydraulic-hose",[[davitX+.10,BOAT_DECK_Y+.60,davitZ],
      [davitX+.17,6.75,davitZ-.15],[davitX+.17,7.51,davitZ]],.029,dark);
    const drum=cylinder("RHIB-hoist-winch",.43,.59,davitX,7.12,davitZ+.34,dark);drum.rotation.x=Math.PI/2;
    tube("RHIB-hoist-wire",[[davitX,7.15,davitZ+.64],[side*5.5,9.56,davitZ+.75],[bx,9.76,bz-2.84],
      [bx,by+1.85,bz-2.84]],.019,dark);
    torus("RHIB-lifting-hook",.19,.042,bx,by+1.83,bz-2.84,radar).rotation.x=Math.PI/2;
  }

  // Visible service systems on the forward-facing aft bulkhead, behind the
  // open boat bay; shared rake keeps doors, pipe clips and ladder seated.
  const aft=DESTROYER_HOUSES.aft;
  const aftFront = (x: number, y: number, offset = 0): MountSurface => {
    const normal = new Vector3(0,aft.inset/aft.height,1).normalize();
    return {point:new Vector3(x,y,aft.z+aft.depth/2-aft.inset*(y-aft.y)/aft.height).add(normal.scale(offset)),normal};
  };
  const wallBox = (name:string,w:number,h:number,t:number,x:number,y:number,material=gray,offset=0) =>
    seatSurfaceBox(box(name,t,h,w,0,0,0,material),aftFront(x,y),t,offset);
  for(const [x,y] of [[-2.0,6.70],[2.60,6.55]]) {
    wallBox("boat-deck-electrical-cabinet",.74,1.0,.29,x,y,light);
    wallBox("boat-deck-cabinet-door",.62,.81,.045,x,y,gray,.27);
    wallBox("boat-deck-cabinet-latch",.07,.16,.055,x+.22,y,dark,.31);
    wallBox("boat-deck-cabinet-identification",.29,.08,.025,x,y+.27,white,.325);
  }
  wallBox("boat-deck-bulkhead-door-frame",1.11,2.07,.15,.05,6.52,radar);
  wallBox("boat-deck-bulkhead-door",.93,1.86,.12,.05,6.53,gray,.13);
  for(const y of [5.94,7.10])wallBox("boat-deck-door-dog",.20,.08,.06,.36,y,light,.25);
  for(const x of [-1.3,1.3]) {
    const path=[5.68,6.22,7.46,8.30].map(y=>aftFront(x,y,.13).point.asArray());
    tube("boat-bay-exposed-pipe-riser",path,.065,light);
    for(const y of [5.85,6.7,7.7])tube("boat-bay-pipe-standoff",
      [aftFront(x,y).point.asArray(),aftFront(x,y,.15).point.asArray()],.038,gray);
    const p=aftFront(x,6.31,.19).point;
    torus("boat-bay-fire-main-valve",.29,.036,p.x,p.y,p.z,dark).rotation.x=Math.PI/2;
  }
  tube("boat-bay-overhead-pipe",[-3.8,-1.3,1.3,3.8].map(x=>aftFront(x,8.30,.13).point.asArray()),.067,light);
  const ladderX=-3.15;
  for(const dx of [-.30,.30])tube("boat-bay-access-ladder-rail",[aftFront(ladderX+dx,5.5,.16).point.asArray(),
    aftFront(ladderX+dx,10.76,.16).point.asArray()],.052,light);
  for(let y=5.68;y<10.65;y+=.34)tube("boat-bay-access-ladder-rung",[aftFront(ladderX-.30,y,.17).point.asArray(),
    aftFront(ladderX+.30,y,.17).point.asArray()],.036,light);
  for(const y of [5.8,7.8,9.8])for(const dx of [-.3,.3])tube("boat-bay-ladder-bracket",
    [aftFront(ladderX+dx,y).point.asArray(),aftFront(ladderX+dx,y,.18).point.asArray()],.042,gray);

  // Four small spherical/hemispherical sensor housings on the bridge roof
  // match the crowded bow-on reference without enlarging its silhouette.
  const roofY=21.875;
  for(const side of [-1,1]) {
    const x=side*4.80,z=28.0;
    cylinder("bridge-reference-radome-foot",1.08,.26,x,roofY+.12,z,gray);
    cylinder("bridge-reference-radome-neck",.67,.54,x,roofY+.52,z,light,.57);
    sphere("bridge-reference-satcom-ball",x,roofY+1.20,z,1.55,1.45,1.55,white);
    torus("bridge-reference-radome-equator",1.54,.025,x,roofY+1.19,z,light);
    const sensorX=side*2.65,sensorZ=30.42;
    cylinder("bridge-reference-sensor-base",1.30,.21,sensorX,roofY+.10,sensorZ,gray);
    cylinder("bridge-reference-sensor-barrel",1.04,.93,sensorX,roofY+.66,sensorZ,light,.98,16);
    sphere("bridge-reference-sensor-dome",sensorX,roofY+1.15,sensorZ,1.12,1.10,1.12,white);
    for(const y of [roofY+.33,roofY+.85])torus("bridge-reference-sensor-collar",1.055,.032,sensorX,y,sensorZ,gray);
    box("bridge-reference-cable-terminal",.25,.34,.21,sensorX+.63,roofY+.21,sensorZ,radar);
    tube("bridge-reference-conduit",[[sensorX+.65,roofY+.055,sensorZ],[side*3.4,roofY+.055,29.10],
      [x,roofY+.055,z]],.033,gray);
  }
  cylinder("bridge-reference-optical-sensor-pedestal",.49,.79,0,roofY+.38,31.00,light);
  sphere("bridge-reference-optical-sensor",0,roofY+.99,31.00,.66,.61,.60,gray);
  box("bridge-reference-optical-sensor-lens",.24,.18,.065,0,roofY+.98,31.32,glass);
  // A modest pair of vents at the edges of the forecastle faces the working
  // deck; their bases share the actual deck sheer.
  for(const side of [-1,1]) {
    const x=side*5.50,z=39.8,y=deckHeight(z);
    cylinder("forecastle-cowl-vent-neck",.39,.69,x,y+.34,z,gray);
    sphere("forecastle-cowl-vent-hood",x,y+.74,z,.65,.48,.64,light);
    box("forecastle-cowl-vent-opening",.42,.19,.065,x,y+.71,z+.30,radar);
  }
}
