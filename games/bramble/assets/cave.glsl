// The cave's darkness, as its layer is laid over the world: the light map (the dark, with the lantern's light added into it)
// flickers a little where it is lit, and darkens towards the edges of the screen. params[0] is how much the light flickers (0 to 1).
vec4 effect(vec2 uv) {
  vec4 c = texture(image, uv);
  float flicker = 1.0 - params[0] * (0.5 + 0.5 * sin(time * 11.0) * sin(time * 7.3));
  float lit = max(c.r, max(c.g, c.b));
  vec2 d = pixel / resolution - 0.5;
  float vignette = 1.0 - 0.9 * dot(d, d);
  return vec4(c.rgb * mix(1.0, flicker, lit) * vignette, c.a);
}
