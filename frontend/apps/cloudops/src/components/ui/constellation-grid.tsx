import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  radius: number;
  pulse: number;
  column: number;
  row: number;
}

/** A low-contrast, interactive mesh that sits behind the CloudOps UI. */
export default function ConstellationGrid() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const drawingCanvas = canvas as HTMLCanvasElement;
    const drawingContext = ctx as CanvasRenderingContext2D;

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const themeObserver = new MutationObserver(drawThemeChange);
    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let frameId = 0;
    let lastFrameTime = 0;
    const spacing = 88;
    const mouse = { x: -1000, y: -1000, vx: 0, vy: 0, previousX: -1000, previousY: -1000 };

    function isDark() {
      return document.documentElement.dataset.theme !== 'light';
    }

    function createNodes() {
      const columns = Math.ceil(width / spacing) + 1;
      const rows = Math.ceil(height / spacing) + 1;
      nodes = [];
      for (let column = 0; column < columns; column += 1) {
        for (let row = 0; row < rows; row += 1) {
          const x = column * spacing;
          const y = row * spacing;
          nodes.push({
            x, y, baseX: x, baseY: y, vx: 0, vy: 0,
            radius: Math.random() * 1.1 + 1,
            pulse: Math.random() * Math.PI * 2,
            column, row,
          });
        }
      }
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      drawingCanvas.width = Math.round(width * dpr);
      drawingCanvas.height = Math.round(height * dpr);
      drawingContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      createNodes();
      drawFrame(0.016);
    }

    function drawThemeChange() {
      if (motionPreference.matches) drawFrame(0.016);
    }

    function drawFrame(elapsed: number) {
      const dark = isDark();
      const nodeColor = dark ? '226, 232, 240' : '51, 65, 85';
      const accentColor = dark ? '56, 189, 248' : '2, 132, 199';
      const speed = Math.hypot(mouse.vx, mouse.vy);

      drawingContext.clearRect(0, 0, width, height);

      if (!motionPreference.matches) {
        for (const node of nodes) {
          const dx = mouse.x - node.x;
          const dy = mouse.y - node.y;
          const distance = Math.hypot(dx, dy);
          if (distance < 190 && distance > 0) {
            const strength = (1 - distance / 190) * (500 + speed * 30) * elapsed;
            node.vx -= (dx / distance) * strength;
            node.vy -= (dy / distance) * strength;
          }

          node.vx += (node.baseX - node.x) * 14 * elapsed;
          node.vy += (node.baseY - node.y) * 14 * elapsed;
          node.vx *= 0.84;
          node.vy *= 0.84;
          node.x += node.vx * elapsed * 60;
          node.y += node.vy * elapsed * 60;
          node.pulse += elapsed * 2.4;
        }
      }

      // Connect only neighboring grid points; this avoids the demo's all-pairs scan.
      const byCell = new Map<string, Node>();
      for (const node of nodes) byCell.set(`${node.column}:${node.row}`, node);
      const directions = [[1, 0], [0, 1], [1, 1], [-1, 1]] as const;
      for (const node of nodes) {
        for (const [columnStep, rowStep] of directions) {
          const neighbor = byCell.get(`${node.column + columnStep}:${node.row + rowStep}`);
          if (!neighbor) continue;
          const distance = Math.hypot(node.x - neighbor.x, node.y - neighbor.y);
          const alpha = Math.max(0, 1 - distance / (spacing * 1.55)) * (dark ? 0.12 : 0.09);
          if (!alpha) continue;
          drawingContext.strokeStyle = `rgba(${nodeColor}, ${alpha})`;
          drawingContext.lineWidth = 0.7;
          drawingContext.beginPath();
          drawingContext.moveTo(node.x, node.y);
          drawingContext.lineTo(neighbor.x, neighbor.y);
          drawingContext.stroke();
        }
      }

      for (const node of nodes) {
        const distance = Math.hypot(mouse.x - node.x, mouse.y - node.y);
        const nearby = !motionPreference.matches && distance < 190;
        const opacity = nearby ? 0.72 : 0.16 + Math.sin(node.pulse) * 0.045;
        drawingContext.fillStyle = nearby ? `rgba(${accentColor}, ${opacity})` : `rgba(${nodeColor}, ${opacity})`;
        drawingContext.beginPath();
        drawingContext.arc(node.x, node.y, nearby ? node.radius * 1.8 : node.radius, 0, Math.PI * 2);
        drawingContext.fill();
      }
    }

    function animate(now: number) {
      const elapsed = Math.min((now - (lastFrameTime || now)) / 1000, 0.04);
      lastFrameTime = now;
      mouse.vx = (mouse.x - mouse.previousX) / (elapsed * 1000 || 1);
      mouse.vy = (mouse.y - mouse.previousY) / (elapsed * 1000 || 1);
      mouse.previousX = mouse.x;
      mouse.previousY = mouse.y;
      drawFrame(elapsed);
      frameId = window.requestAnimationFrame(animate);
    }

    function handlePointerMove(event: PointerEvent) {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    }

    function handlePointerLeave() {
      mouse.x = -1000;
      mouse.y = -1000;
    }

    function handleMotionChange() {
      window.cancelAnimationFrame(frameId);
      lastFrameTime = 0;
      if (motionPreference.matches) drawFrame(0.016);
      else frameId = window.requestAnimationFrame(animate);
    }

    resize();
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave);
    motionPreference.addEventListener('change', handleMotionChange);
    if (!motionPreference.matches) frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
      themeObserver.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
      motionPreference.removeEventListener('change', handleMotionChange);
    };
  }, []);

  return <canvas ref={canvasRef} className="constellation-grid" aria-hidden="true" />;
}
