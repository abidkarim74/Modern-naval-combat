// Register the optional scene passes before their first frame. This prevents
// lazy shader lookup from requesting .fx URLs from Vite's HTML fallback.
import "@babylonjs/core/ShadersWGSL/pbr.vertex";
import "@babylonjs/core/ShadersWGSL/pbr.fragment";
import "@babylonjs/core/ShadersWGSL/default.vertex";
import "@babylonjs/core/ShadersWGSL/default.fragment";
import "@babylonjs/core/Shaders/pbr.vertex";
import "@babylonjs/core/Shaders/pbr.fragment";
import "@babylonjs/core/Shaders/default.vertex";
import "@babylonjs/core/Shaders/default.fragment";
import "@babylonjs/core/ShadersWGSL/particles.vertex";
import "@babylonjs/core/ShadersWGSL/particles.fragment";
import "@babylonjs/core/Shaders/particles.vertex";
import "@babylonjs/core/Shaders/particles.fragment";
import "@babylonjs/core/ShadersWGSL/sprites.vertex";
import "@babylonjs/core/ShadersWGSL/sprites.fragment";
import "@babylonjs/core/ShadersWGSL/shadowMap.vertex";
import "@babylonjs/core/ShadersWGSL/shadowMap.fragment";
import "@babylonjs/core/ShadersWGSL/postprocess.vertex";
import "@babylonjs/core/ShadersWGSL/rgbdDecode.fragment";
import "@babylonjs/core/ShadersWGSL/rgbdEncode.fragment";
import "@babylonjs/core/Shaders/sprites.vertex";
import "@babylonjs/core/Shaders/sprites.fragment";
import "@babylonjs/core/Shaders/shadowMap.vertex";
import "@babylonjs/core/Shaders/shadowMap.fragment";
import "@babylonjs/core/Shaders/postprocess.vertex";
import "@babylonjs/core/Shaders/rgbdDecode.fragment";
import "@babylonjs/core/Shaders/rgbdEncode.fragment";
