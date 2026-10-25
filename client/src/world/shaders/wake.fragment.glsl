precision highp float;

uniform sampler2D foamSampler;
uniform float nightFactor;
varying vec2 vFoamUv;
varying vec4 vFoamColor;

void main(void) {
  vec4 foam = texture2D(foamSampler, vFoamUv);
  vec3 dayColor = vec3(0.78, 0.86, 0.9);
  vec3 nightColor = vec3(0.14, 0.22, 0.32);
  vec3 tint = mix(dayColor, nightColor, nightFactor);
  gl_FragColor = vec4(foam.rgb * vFoamColor.rgb * tint,
    foam.a * vFoamColor.a * 0.94);
}
