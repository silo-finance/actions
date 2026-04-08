'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

type Breakpoint = 'lg' | 'md' | 'sm'
type CircleCfg = {
  position: { x: number; y: number }
  radius: number
  speed: { x: number; y: number }
  amplitude: { x: number; y: number }
  offset: { x: number; y: number }
  md?: { position?: { x: number; y: number }; radius?: number }
  sm?: { position?: { x: number; y: number }; radius?: number }
}

type EffectParams = {
  smoothness: number
  thickness: number
  globalSpeed: number
  globalAmplitude: number
  md?: Partial<EffectParams>
  sm?: Partial<EffectParams>
}

const circlesConfig: CircleCfg[] = [
  {
    position: { x: 0.18, y: 0.07 },
    radius: 0.065,
    speed: { x: 0.25, y: 0.84 },
    amplitude: { x: 0.06, y: 0.02 },
    offset: { x: 1.5, y: 0.8 },
    md: { position: { x: 0.18, y: 0.09 }, radius: 0.08 },
    sm: { position: { x: 0.18, y: 0.11 }, radius: 0.1 },
  },
  {
    position: { x: 0.12, y: 0.16 },
    radius: 0.1,
    speed: { x: 0.3, y: 0.25 },
    amplitude: { x: 0.02, y: 0.02 },
    offset: { x: 0.0, y: 0.0 },
    md: { position: { x: 0.12, y: 0.26 }, radius: 0.176 },
    sm: { position: { x: 0.12, y: 0.3 }, radius: 0.22 },
  },
  {
    position: { x: 0.9, y: 0.18 },
    radius: 0.03,
    speed: { x: 0.25, y: 0.25 },
    amplitude: { x: 0.06, y: 0.01 },
    offset: { x: 4.2, y: 3.5 },
    md: { position: { x: 0.9, y: 0.26 }, radius: 0.048 },
    sm: { position: { x: 0.86, y: 0.45 }, radius: 0.06 },
  },
  {
    position: { x: 0.85, y: 0.29 },
    radius: 0.11,
    speed: { x: 0.28, y: 0.32 },
    amplitude: { x: 0.02, y: 0.02 },
    offset: { x: 3.14, y: 2.0 },
    md: { position: { x: 0.85, y: 0.46 }, radius: 0.176 },
    sm: { position: { x: 0.8, y: 0.7 }, radius: 0.22 },
  },
  {
    position: { x: 0.9, y: 0.39 },
    radius: 0.06,
    speed: { x: 0.32, y: 0.38 },
    amplitude: { x: 0.025, y: 0.0 },
    offset: { x: 5.5, y: 4.8 },
    md: { position: { x: 0.92, y: 0.56 }, radius: 0.096 },
    sm: { position: { x: 0.86, y: 0.9 }, radius: 0.12 },
  },
]

const effectParams: EffectParams = {
  smoothness: 0.01,
  thickness: 0.0027,
  globalSpeed: 0.8,
  globalAmplitude: 0.8,
  md: { smoothness: 0.012, thickness: 0.0032, globalSpeed: 0.8, globalAmplitude: 0.8 },
  sm: { smoothness: 0.03, thickness: 0.0042, globalSpeed: 0.8, globalAmplitude: 0.8 },
}

const LEFT_GROUP_X_SHIFT = -0.14
const RIGHT_GROUP_X_SHIFT = 0.15
const RIGHT_GROUP_Y_SHIFT = 0.1
const LEFT_GROUP_SCALE = 1.01
const RIGHT_GROUP_SCALE = 1.75

function getBreakpoint(): Breakpoint {
  const w = window.innerWidth
  if (w <= 576) return 'sm'
  if (w <= 992) return 'md'
  return 'lg'
}

function getCircleValues(circle: CircleCfg, bp: Breakpoint) {
  if (bp === 'sm' && circle.sm) {
    return { position: circle.sm.position ?? circle.position, radius: circle.sm.radius ?? circle.radius }
  }
  if (bp === 'md' && circle.md) {
    return { position: circle.md.position ?? circle.position, radius: circle.md.radius ?? circle.radius }
  }
  return { position: circle.position, radius: circle.radius }
}

function getEffectValues(bp: Breakpoint): EffectParams {
  if (bp === 'sm' && effectParams.sm) return { ...effectParams, ...effectParams.sm }
  if (bp === 'md' && effectParams.md) return { ...effectParams, ...effectParams.md }
  return effectParams
}

export default function AnimatedCirclesBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const MAX_CIRCLES = 5

    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCenters: { value: Array.from({ length: MAX_CIRCLES }, () => new THREE.Vector2()) },
      uRadii: { value: new Float32Array(MAX_CIRCLES) },
      uSmoothness: { value: 0.01 },
      uThickness: { value: 0.0027 },
    }

    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying vec2 vUv;
        uniform vec2  uResolution;
        uniform vec2  uCenters[5];
        uniform float uRadii[5];
        uniform float uSmoothness;
        uniform float uThickness;

        float smin(float a, float b, float k) {
          float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
          return mix(b, a, h) - k * h * (1.0 - h);
        }

        float sdCircle(vec2 p, float r) {
          return length(p) - r;
        }

        vec2 toScreen(vec2 uv) {
          return vec2(
            uv.x * uResolution.x,
            uResolution.y - (uv.y * uResolution.x)
          );
        }

        void main() {
          vec2 p = vUv * uResolution;
          float k = uSmoothness * uResolution.x;

          float dL = abs(sdCircle(p - toScreen(uCenters[0]), uRadii[0] * uResolution.x));
          dL = smin(dL, abs(sdCircle(p - toScreen(uCenters[1]), uRadii[1] * uResolution.x)), k);

          float dR = abs(sdCircle(p - toScreen(uCenters[2]), uRadii[2] * uResolution.x));
          dR = smin(dR, abs(sdCircle(p - toScreen(uCenters[3]), uRadii[3] * uResolution.x)), k);
          dR = smin(dR, abs(sdCircle(p - toScreen(uCenters[4]), uRadii[4] * uResolution.x)), k);

          float d = min(dL, dR);

          float thick = uThickness * uResolution.x;
          float alpha = 1.0 - smoothstep(thick - 1.5, thick + 1.5, d);

          gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
        }
      `,
    })

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    scene.add(mesh)

    let currentBreakpoint = getBreakpoint()
    let currentParams = getEffectValues(currentBreakpoint)

    const applyBreakpoint = () => {
      currentBreakpoint = getBreakpoint()
      currentParams = getEffectValues(currentBreakpoint)
      uniforms.uSmoothness.value = currentParams.smoothness
      uniforms.uThickness.value = currentParams.thickness

      const radii = uniforms.uRadii.value
      for (let i = 0; i < circlesConfig.length; i++) {
        const baseRadius = getCircleValues(circlesConfig[i], currentBreakpoint).radius
        radii[i] = i >= 2 ? baseRadius * RIGHT_GROUP_SCALE : baseRadius * LEFT_GROUP_SCALE
      }
    }

    const applySize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      if (width <= 0 || height <= 0) return
      renderer.setPixelRatio(width < 768 ? 1 : Math.min(window.devicePixelRatio, 1.5))
      renderer.setSize(width, height, false)
      uniforms.uResolution.value.set(width, height)
    }

    applyBreakpoint()
    applySize()

    let isInView = true
    let paused = false
    let startTime = 0
    let timeOffset = 0

    const visibilityObserver =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(entries => {
            isInView = entries[0]?.isIntersecting ?? true
          }, { rootMargin: '50px' })
        : null
    visibilityObserver?.observe(canvas)

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            applySize()
          })
        : null
    resizeObserver?.observe(container)

    let resizeTimeout: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        const nextBreakpoint = getBreakpoint()
        if (nextBreakpoint !== currentBreakpoint) applyBreakpoint()
        applySize()
      }, 100)
    }

    const onVisibility = () => {
      if (document.hidden) {
        timeOffset = uniforms.uTime.value
        paused = true
      } else {
        startTime = 0
        paused = false
      }
    }

    window.addEventListener('resize', onResize, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)

    let raf = 0
    const loop = (time: number) => {
      raf = requestAnimationFrame(loop)
      if (!isInView || paused) return

      if (startTime === 0) {
        startTime = time - (timeOffset / currentParams.globalSpeed) * 1000
      }

      const t = ((time - startTime) / 1000) * currentParams.globalSpeed
      uniforms.uTime.value = t
      const centers = uniforms.uCenters.value
      const globalAmplitude = currentParams.globalAmplitude

      for (let i = 0; i < circlesConfig.length; i++) {
        const circle = circlesConfig[i]
        const { position } = getCircleValues(circle, currentBreakpoint)
        const xShift = i < 2 ? LEFT_GROUP_X_SHIFT : RIGHT_GROUP_X_SHIFT
        const yShift = i >= 2 ? RIGHT_GROUP_Y_SHIFT : 0
        centers[i].x =
          position.x +
          xShift +
          Math.sin(t * circle.speed.x + circle.offset.x) * circle.amplitude.x * globalAmplitude
        centers[i].y =
          position.y + yShift + Math.cos(t * circle.speed.y + circle.offset.y) * circle.amplitude.y * globalAmplitude
      }

      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver?.disconnect()
      visibilityObserver?.disconnect()
      mesh.geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [])

  return (
    <div ref={containerRef} aria-hidden className="animated-circles-bg">
      <canvas ref={canvasRef} className="animated-circles-canvas" />
    </div>
  )
}
