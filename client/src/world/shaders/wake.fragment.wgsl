var foamSamplerSampler: sampler;
var foamSampler: texture_2d<f32>;
varying vFoamUv: vec2<f32>;
varying vFoamColor: vec4<f32>;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let foam = textureSample(foamSampler, foamSamplerSampler, fragmentInputs.vFoamUv);
  fragmentOutputs.color = vec4<f32>(foam.rgb * fragmentInputs.vFoamColor.rgb * vec3<f32>(0.78, 0.86, 0.9),
    foam.a * fragmentInputs.vFoamColor.a * 0.94);
}
