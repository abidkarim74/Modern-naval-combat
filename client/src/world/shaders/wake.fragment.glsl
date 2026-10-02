precision highp float;

uniform sampler2D foamSampler;
varying vec2 vFoamUv;
varying vec4 vFoamColor;

void main(void) {
  vec4 foam = texture2D(foamSampler, vFoamUv);
  gl_FragColor = vec4(foam.rgb * vFoamColor.rgb * vec3(0.78, 0.86, 0.9),
    foam.a * vFoamColor.a * 0.94);
}
