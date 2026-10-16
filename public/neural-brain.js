// NotExist Intelligience Studio - Neural Brain Visualizer Engine
// High-performance Canvas Force-Directed Neural Graph with Animated Synapses

class NeuralBrainVisualizer {
  constructor(canvasContainerId, options = {}) {
    this.container = document.getElementById(canvasContainerId);
    if (!this.container) return;

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);

    this.options = {
      scopeFilter: 'all', // 'all', 'project', 'global'
      typeFilter: 'all',  // 'all', 'step', 'variable', 'data', 'rule', 'goal'
      searchQuery: '',
      onNodeSelect: options.onNodeSelect || null,
      ...options
    };

    // Graph Data
    this.rawNodes = [];
    this.rawEdges = [];
    this.nodes = [];
    this.edges = [];
    this.nodeMap = new Map();

    // Camera Transform (Pan & Zoom)
    this.camera = {
      x: 0,
      y: 0,
      scale: 1,
      targetScale: 1
    };

    // Interaction State
    this.hoveredNode = null;
    this.selectedNode = null;
    this.draggedNode = null;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.mousePos = { x: 0, y: 0 };

    // Synaptic electrical action potentials (animated pulse particles)
    this.pulses = [];
    this.maxPulses = 35;

    // Category Color Palette & Icons
    this.categoryStyles = {
      variable: {
        color: '#10b981',
        glow: 'rgba(16, 185, 129, 0.45)',
        label: 'Variabile',
        symbol: 'x='
      },
      step: {
        color: '#06b6d4',
        glow: 'rgba(6, 182, 212, 0.45)',
        label: 'Passaggio',
        symbol: '➜'
      },
      data: {
        color: '#f59e0b',
        glow: 'rgba(245, 158, 11, 0.45)',
        label: 'Dato / Nota',
        symbol: '🗎'
      },
      rule: {
        color: '#a855f7',
        glow: 'rgba(168, 85, 247, 0.45)',
        label: 'Regola Globale',
        symbol: '★'
      },
      goal: {
        color: '#e07a5f',
        glow: 'rgba(224, 122, 95, 0.45)',
        label: 'Obiettivo',
        symbol: '🎯'
      }
    };

    this.initCanvasSize();
    this.initEvents();
    this.startAnimationLoop();
  }

  initCanvasSize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 800;
    this.height = rect.height || 600;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    // Reset transform to prevent cumulative DPR scaling on repeated calls
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  setData(graphData) {
    this.rawNodes = graphData.nodes || [];
    this.rawEdges = graphData.edges || [];
    this.applyFilters();
  }

  setFilters({ scopeFilter, typeFilter, searchQuery }) {
    if (scopeFilter !== undefined) this.options.scopeFilter = scopeFilter;
    if (typeFilter !== undefined) this.options.typeFilter = typeFilter;
    if (searchQuery !== undefined) this.options.searchQuery = searchQuery.toLowerCase().trim();
    this.applyFilters();
  }

  applyFilters() {
    const { scopeFilter, typeFilter, searchQuery } = this.options;
    const oldPositions = new Map();
    this.nodes.forEach(n => oldPositions.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy }));

    const filteredRawNodes = this.rawNodes.filter(n => {
      if (scopeFilter !== 'all' && n.scope !== scopeFilter) return false;
      if (typeFilter !== 'all' && n.type !== typeFilter) return false;
      if (searchQuery) {
        const text = `${n.label} ${n.value} ${(n.tags || []).join(' ')}`.toLowerCase();
        if (!text.includes(searchQuery)) return false;
      }
      return true;
    });

    const activeNodeIds = new Set(filteredRawNodes.map(n => n.id));

    // Filter edges: both source and target must be in active nodes
    const filteredEdges = this.rawEdges.filter(e => activeNodeIds.has(e.source) && activeNodeIds.has(e.target));

    // Build visual nodes
    this.nodeMap.clear();
    const radiusBase = Math.min(this.width, this.height) * 0.35;

    this.nodes = filteredRawNodes.map((n, i) => {
      const old = oldPositions.get(n.id);
      const angle = (i / Math.max(1, filteredRawNodes.length)) * Math.PI * 2;
      const initialDist = 40 + Math.random() * radiusBase;

      const nodeObj = {
        ...n,
        x: old ? old.x : Math.cos(angle) * initialDist,
        y: old ? old.y : Math.sin(angle) * initialDist,
        vx: old ? old.vx : 0,
        vy: old ? old.vy : 0,
        radius: n.scope === 'global' ? 24 : 20,
        mass: n.scope === 'global' ? 2.5 : 1.5,
        pulsePhase: Math.random() * Math.PI * 2
      };
      this.nodeMap.set(n.id, nodeObj);
      return nodeObj;
    });

    this.edges = filteredEdges.map(e => ({
      ...e,
      sourceNode: this.nodeMap.get(e.source),
      targetNode: this.nodeMap.get(e.target)
    })).filter(e => e.sourceNode && e.targetNode);

    // Re-link pulses
    this.pulses = [];
    this.initPulses();
  }

  initPulses() {
    if (this.edges.length === 0) return;
    for (let i = 0; i < Math.min(this.maxPulses, this.edges.length * 3); i++) {
      const edge = this.edges[Math.floor(Math.random() * this.edges.length)];
      this.pulses.push({
        edge,
        progress: Math.random(),
        speed: 0.006 + Math.random() * 0.008,
        size: 2.5 + Math.random() * 2
      });
    }
  }

  initEvents() {
    window.addEventListener('resize', () => this.initCanvasSize());

    // Mouse Move & Hover
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const worldPos = this.screenToWorld(this.mousePos.x, this.mousePos.y);

      if (this.isPanning) {
        this.camera.x += (this.mousePos.x - this.panStart.x);
        this.camera.y += (this.mousePos.y - this.panStart.y);
        this.panStart = { ...this.mousePos };
        return;
      }

      if (this.draggedNode) {
        this.draggedNode.x = worldPos.x;
        this.draggedNode.y = worldPos.y;
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
        return;
      }

      // Check node hover
      let found = null;
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const node = this.nodes[i];
        const dist = Math.hypot(node.x - worldPos.x, node.y - worldPos.y);
        if (dist <= node.radius + 6) {
          found = node;
          break;
        }
      }

      this.hoveredNode = found;
      this.canvas.style.cursor = found ? 'pointer' : (this.isPanning ? 'grabbing' : 'grab');
    });

    // Mouse Down
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const worldPos = this.screenToWorld(clickX, clickY);

      if (e.button === 0) { // Left click
        let clickedNode = null;
        for (let i = this.nodes.length - 1; i >= 0; i--) {
          const node = this.nodes[i];
          if (Math.hypot(node.x - worldPos.x, node.y - worldPos.y) <= node.radius + 6) {
            clickedNode = node;
            break;
          }
        }

        if (clickedNode) {
          this.draggedNode = clickedNode;
          this.selectNode(clickedNode);
        } else {
          this.isPanning = true;
          this.panStart = { x: clickX, y: clickY };
        }
      } else if (e.button === 1 || e.button === 2) { // Middle or right click
        this.isPanning = true;
        this.panStart = { x: clickX, y: clickY };
      }
    });

    // Mouse Up
    window.addEventListener('mouseup', () => {
      this.draggedNode = null;
      this.isPanning = false;
      this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
    });

    // Prevent context menu on canvas
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Wheel Zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newScale = Math.max(0.2, Math.min(3.5, this.camera.scale * zoomFactor));

      // Zoom toward cursor point
      this.camera.x = mouseX - (mouseX - this.camera.x) * (newScale / this.camera.scale);
      this.camera.y = mouseY - (mouseY - this.camera.y) * (newScale / this.camera.scale);
      this.camera.scale = newScale;
    }, { passive: false });
  }

  selectNode(node) {
    this.selectedNode = node;
    if (typeof this.options.onNodeSelect === 'function') {
      this.options.onNodeSelect(node);
    }
  }

  resetView() {
    this.camera.scale = 1;
    this.camera.x = this.width / 2;
    this.camera.y = this.height / 2;
  }

  focusNode(nodeId) {
    const node = this.nodeMap.get(nodeId);
    if (!node) return;
    this.selectNode(node);
    this.camera.scale = 1.3;
    this.camera.x = this.width / 2 - node.x * this.camera.scale;
    this.camera.y = this.height / 2 - node.y * this.camera.scale;
  }

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.camera.x) / this.camera.scale,
      y: (screenY - this.camera.y) / this.camera.scale
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: worldX * this.camera.scale + this.camera.x,
      y: worldY * this.camera.scale + this.camera.y
    };
  }

  // Physics simulation step
  updatePhysics() {
    const kRepulsion = 1800;
    const kAttraction = 0.05;
    const centerGravity = 0.002;
    const damping = 0.88;
    const maxVelocity = 12;

    // Repulsion between all pairs of nodes
    for (let i = 0; i < this.nodes.length; i++) {
      const nodeA = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const nodeB = this.nodes[j];
        let dx = nodeB.x - nodeA.x;
        let dy = nodeB.y - nodeA.y;
        let dist = Math.hypot(dx, dy) || 1;

        const force = kRepulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (nodeA !== this.draggedNode) {
          nodeA.vx -= fx / nodeA.mass;
          nodeA.vy -= fy / nodeA.mass;
        }
        if (nodeB !== this.draggedNode) {
          nodeB.vx += fx / nodeB.mass;
          nodeB.vy += fy / nodeB.mass;
        }
      }
    }

    // Spring attraction along synaptic edges
    for (const edge of this.edges) {
      const a = edge.sourceNode;
      const b = edge.targetNode;
      if (!a || !b) continue;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy) || 1;

      const idealDistance = 140;
      const delta = dist - idealDistance;
      const force = delta * kAttraction * (edge.strength || 1);

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (a !== this.draggedNode) {
        a.vx += fx / a.mass;
        a.vy += fy / a.mass;
      }
      if (b !== this.draggedNode) {
        b.vx -= fx / b.mass;
        b.vy -= fy / b.mass;
      }
    }

    // Central Gravity & Position update
    for (const node of this.nodes) {
      if (node === this.draggedNode) continue;

      node.vx -= node.x * centerGravity;
      node.vy -= node.y * centerGravity;

      node.vx *= damping;
      node.vy *= damping;

      const speed = Math.hypot(node.vx, node.vy);
      if (speed > maxVelocity) {
        node.vx = (node.vx / speed) * maxVelocity;
        node.vy = (node.vy / speed) * maxVelocity;
      }

      node.x += node.vx;
      node.y += node.vy;
    }

    // Update pulses
    for (const pulse of this.pulses) {
      pulse.progress += pulse.speed;
      if (pulse.progress >= 1) {
        pulse.progress = 0;
        if (this.edges.length > 0 && Math.random() < 0.2) {
          pulse.edge = this.edges[Math.floor(Math.random() * this.edges.length)];
        }
      }
    }
  }

  startAnimationLoop() {
    if (this.camera.x === 0 && this.camera.y === 0) {
      this.camera.x = this.width / 2;
      this.camera.y = this.height / 2;
    }

    const loop = () => {
      this.updatePhysics();
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(this.camera.scale, this.camera.scale);

    // 1. Grid
    this.drawBackgroundGrid(ctx);

    // 2. Synapses
    this.drawSynapses(ctx);

    // 3. Action potential pulses
    this.drawPulses(ctx);

    // 4. Neurons
    this.drawNeurons(ctx);

    ctx.restore();

    // 5. Hover overlay
    this.drawOverlay(ctx);
  }

  drawBackgroundGrid(ctx) {
    const gridSize = 80;
    const viewLeft = -this.camera.x / this.camera.scale;
    const viewTop = -this.camera.y / this.camera.scale;
    const viewRight = (this.width - this.camera.x) / this.camera.scale;
    const viewBottom = (this.height - this.camera.y) / this.camera.scale;

    const startX = Math.floor(viewLeft / gridSize) * gridSize;
    const startY = Math.floor(viewTop / gridSize) * gridSize;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (let x = startX; x <= viewRight; x += gridSize) {
      for (let y = startY; y <= viewBottom; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawSynapses(ctx) {
    ctx.save();
    for (const edge of this.edges) {
      const a = edge.sourceNode;
      const b = edge.targetNode;
      if (!a || !b) continue;

      const isConnectedToSelected = this.selectedNode && (this.selectedNode.id === a.id || this.selectedNode.id === b.id);
      const isConnectedToHovered = this.hoveredNode && (this.hoveredNode.id === a.id || this.hoveredNode.id === b.id);

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);

      if (isConnectedToSelected) {
        ctx.strokeStyle = '#e07a5f';
        ctx.lineWidth = 2.4;
        ctx.shadowColor = 'rgba(224, 122, 95, 0.6)';
        ctx.shadowBlur = 8;
      } else if (isConnectedToHovered) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 1.8;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
        ctx.shadowBlur = 4;
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1.2;
        ctx.shadowBlur = 0;
      }
      ctx.stroke();

      // Synapse Label at midpoint
      if (edge.label && (isConnectedToSelected || isConnectedToHovered || this.camera.scale > 1.2)) {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;

        ctx.save();
        ctx.font = '9px "Fira Code", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const textWidth = ctx.measureText(edge.label).width;

        ctx.fillStyle = 'rgba(12, 13, 16, 0.85)';
        ctx.fillRect(midX - textWidth / 2 - 4, midY - 6, textWidth + 8, 12);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(midX - textWidth / 2 - 4, midY - 6, textWidth + 8, 12);

        ctx.fillStyle = isConnectedToSelected ? '#e07a5f' : '#9ca3af';
        ctx.fillText(edge.label, midX, midY);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawPulses(ctx) {
    ctx.save();
    for (const pulse of this.pulses) {
      if (!pulse.edge) continue;
      const a = pulse.edge.sourceNode;
      const b = pulse.edge.targetNode;
      if (!a || !b) continue;

      const px = a.x + (b.x - a.x) * pulse.progress;
      const py = a.y + (b.y - a.y) * pulse.progress;

      const style = this.categoryStyles[a.type] || this.categoryStyles.data;

      ctx.beginPath();
      ctx.arc(px, py, pulse.size, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = style.color;
      ctx.shadowBlur = 10;
      ctx.fill();
    }
    ctx.restore();
  }

  drawNeurons(ctx) {
    const time = Date.now() * 0.003;

    for (const node of this.nodes) {
      const style = this.categoryStyles[node.type] || this.categoryStyles.data;
      const isSelected = this.selectedNode && this.selectedNode.id === node.id;
      const isHovered = this.hoveredNode && this.hoveredNode.id === node.id;

      ctx.save();

      // Outer Halo Glow
      const haloPulse = Math.sin(time + node.pulsePhase) * 3;
      const glowRadius = node.radius + (isSelected ? 14 : (isHovered ? 10 : 6)) + haloPulse;

      const grad = ctx.createRadialGradient(node.x, node.y, node.radius * 0.4, node.x, node.y, glowRadius);
      grad.addColorStop(0, style.glow);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Node Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#131519';
      ctx.fill();

      // Border
      ctx.strokeStyle = isSelected ? '#ffffff' : style.color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.shadowColor = style.color;
      ctx.shadowBlur = isSelected ? 12 : (isHovered ? 8 : 4);
      ctx.stroke();

      // Core Inner Dot
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = style.color;
      ctx.fill();

      // Global scope indicator ring
      if (node.scope === 'global') {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Selection animation ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#e07a5f';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -time * 10;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Label below node
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillText(node.label, node.x + 1, node.y + node.radius + 6);
      ctx.fillStyle = isSelected ? '#ffffff' : (isHovered ? '#f3f4f6' : '#d1d5db');
      ctx.fillText(node.label, node.x, node.y + node.radius + 5);

      // Scope Pill tag
      ctx.font = '9px "Fira Code", monospace';
      const scopeText = node.scope === 'global' ? 'GLOBALE' : 'PROGETTO';
      ctx.fillStyle = node.scope === 'global' ? '#c084fc' : '#38bdf8';
      ctx.fillText(`[${scopeText}]`, node.x, node.y + node.radius + 18);

      ctx.restore();
    }
  }

  drawOverlay(ctx) {
    if (this.hoveredNode && !this.isPanning && !this.draggedNode) {
      const node = this.hoveredNode;
      const screenPos = this.worldToScreen(node.x, node.y);
      const style = this.categoryStyles[node.type] || this.categoryStyles.data;

      const lines = [
        `[${style.label}] ${node.label}`,
        node.value ? `Dati: ${node.value.length > 55 ? node.value.slice(0, 52) + '...' : node.value}` : null,
        `Sinapsi: ${(node.synapses || []).length} collegamenti`,
        node.tags && node.tags.length > 0 ? `Tags: ${node.tags.join(', ')}` : null
      ].filter(Boolean);

      ctx.save();
      ctx.font = '11px Inter, sans-serif';
      let maxWidth = 0;
      lines.forEach(l => {
        maxWidth = Math.max(maxWidth, ctx.measureText(l).width);
      });

      const pad = 10;
      const boxW = maxWidth + pad * 2;
      const boxH = lines.length * 17 + pad * 1.5;
      const boxX = Math.min(this.width - boxW - 10, Math.max(10, screenPos.x - boxW / 2));
      const boxY = Math.max(10, screenPos.y - node.radius - boxH - 12);

      ctx.fillStyle = 'rgba(19, 21, 25, 0.95)';
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 1;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 12;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(boxX, boxY, boxW, boxH, 6);
      } else {
        ctx.rect(boxX, boxY, boxW, boxH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      lines.forEach((line, idx) => {
        ctx.fillStyle = idx === 0 ? style.color : (idx === 1 ? '#e2e8f0' : '#9ca3af');
        ctx.font = idx === 0 ? 'bold 11px Inter, sans-serif' : '10.5px Inter, sans-serif';
        ctx.fillText(line, boxX + pad, boxY + pad + idx * 17);
      });

      ctx.restore();
    }
  }
}

window.NeuralBrainVisualizer = NeuralBrainVisualizer;
