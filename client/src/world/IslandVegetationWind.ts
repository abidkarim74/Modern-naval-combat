import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { Material } from "@babylonjs/core/Materials/material";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Fixed roots, spatially coherent gusts and distance fade, entirely on the GPU. */
export class IslandVegetationWind extends MaterialPluginBase {
  time = 0;
  range = 0;
  readonly eye = Vector3.Zero();

  constructor(material: Material, private readonly amplitude: number, private readonly height: number) {
    super(material, "IslandVegetationWind", 180, {}, true, true);
  }

  override isCompatible(): boolean { return true; }

  override getUniforms(language: ShaderLanguage) {
    const declaration = language === ShaderLanguage.WGSL ? "" : `
      #ifndef UNIFORMBUFFERS
      uniform float islandWindTime;
      uniform vec4 islandWindParams;
      uniform vec4 islandWindEye;
      #endif`;
    return {
      ubo: [{ name: "islandWindTime", size: 1, type: "float" },
        { name: "islandWindParams", size: 4, type: "vec4" }, { name: "islandWindEye", size: 4, type: "vec4" }],
      vertex: declaration, fragment: declaration,
    };
  }

  override bindForSubMesh(buffer: UniformBuffer): void {
    buffer.updateFloat("islandWindTime", this.time);
    buffer.updateFloat4("islandWindParams", this.amplitude, this.height, this.range * .74, this.range);
    buffer.updateFloat4("islandWindEye", this.eye.x, this.eye.y, this.eye.z, 0);
  }

  override getCustomCode(type: string, language: ShaderLanguage) {
    if (type !== "vertex") return null;
    const wgsl = language === ShaderLanguage.WGSL;
    return { CUSTOM_VERTEX_UPDATE_WORLDPOS: wgsl ? `
      let islandPhase = dot(worldPos.xz, vec2f(.087, .061));
      let islandBend = pow(clamp(positionUpdated.y / uniforms.islandWindParams.y, 0., 1.), 2.);
      let islandGust = sin(uniforms.islandWindTime * 1.6 + islandPhase) * .65
        + sin(uniforms.islandWindTime * .73 + islandPhase * .38) * .35;
      var islandFade = 1.;
      if (uniforms.islandWindParams.w > 0.) {
        islandFade = 1. - smoothstep(uniforms.islandWindParams.z, uniforms.islandWindParams.w,
          distance(worldPos.xyz, uniforms.islandWindEye.xyz));
        worldPos.y -= max(0., positionUpdated.y) * length(finalWorld[1].xyz) * (1. - islandFade);
      }
      worldPos.x += islandGust * islandBend * uniforms.islandWindParams.x * islandFade * .8;
      worldPos.z += islandGust * islandBend * uniforms.islandWindParams.x * islandFade * .6;
      vertexOutputs.vPositionW = worldPos.xyz;
    ` : `
      float islandPhase = dot(worldPos.xz, vec2(.087, .061));
      float islandBend = pow(clamp(positionUpdated.y / islandWindParams.y, 0., 1.), 2.);
      float islandGust = sin(islandWindTime * 1.6 + islandPhase) * .65
        + sin(islandWindTime * .73 + islandPhase * .38) * .35;
      float islandFade = 1.;
      if (islandWindParams.w > 0.) {
        islandFade = 1. - smoothstep(islandWindParams.z, islandWindParams.w, distance(worldPos.xyz, islandWindEye.xyz));
        worldPos.y -= max(0., positionUpdated.y) * length(finalWorld[1].xyz) * (1. - islandFade);
      }
      worldPos.xz += vec2(.8, .6) * islandGust * islandBend * islandWindParams.x * islandFade;
      vPositionW = worldPos.xyz;
    ` };
  }
}
