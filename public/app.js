let map;
let polyline; // Main route (freehand mode)
let previewLine; // Live preview segment while drawing (freehand mode)
let drawing = false;
let clickListener = null;
let moveListener = null;
let outListener = null;

// Driving mode state
let directionsService = null;
let directionsRenderer = null;
let drivingModeEl = null;
let drivingWaypoints = []; // array of LatLngLiteral from clicks

function computePathLengthMeters(path) {
  if (!window.google || !window.google.maps || !google.maps.geometry) return 0;
  const gPath = path.map(p => new google.maps.LatLng(p.lat, p.lng));
  return google.maps.geometry.spherical.computeLength(gPath);
}

function isDrivingMode() {
  return !!(drivingModeEl && drivingModeEl.checked);
}

async function loadGoogleMaps(apiKey) {
  const existing = document.querySelector('script[data-google-maps]');
  if (existing) return;
  const url = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.defer = true;
    script.setAttribute('data-google-maps', '1');
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function getApiKey() {
  const res = await fetch('/config');
  const data = await res.json();
  return data.googleMapsApiKey || '';
}

function setButtonsState(state) {
  const btnStart = document.getElementById('btn-start');
  const btnFinish = document.getElementById('btn-finish');
  const btnClear = document.getElementById('btn-clear');
  const btnSubmit = document.getElementById('btn-submit');

  if (state === 'idle') {
    btnStart.disabled = false;
    btnFinish.disabled = true;
    btnClear.disabled = true;
    btnSubmit.disabled = true;
  } else if (state === 'drawing') {
    btnStart.disabled = true;
    btnFinish.disabled = false;
    btnClear.disabled = false;
    btnSubmit.disabled = true;
  } else if (state === 'done') {
    btnStart.disabled = false;
    btnFinish.disabled = true;
    btnClear.disabled = false;
    // We compute exact enabled state via refreshSubmitEnabled
    refreshSubmitEnabled();
    return;
  }
}

function getDrivingOverviewPath() {
  if (!directionsRenderer) return [];
  const dr = directionsRenderer.getDirections();
  if (!dr || !dr.routes || dr.routes.length === 0) return [];
  const overview = dr.routes[0].overview_path || [];
  return overview.map(ll => ({ lat: ll.lat(), lng: ll.lng() }));
}

function getDrivingTotalMeters() {
  if (!directionsRenderer) return 0;
  const dr = directionsRenderer.getDirections();
  if (!dr || !dr.routes || dr.routes.length === 0) return 0;
  const route = dr.routes[0];
  if (!route.legs) return 0;
  return route.legs.reduce((sum, leg) => sum + (leg.distance ? leg.distance.value : 0), 0);
}

function refreshSubmitEnabled() {
  const btnSubmit = document.getElementById('btn-submit');
  if (!btnSubmit) return;
  if (isDrivingMode()) {
    const ok = !!directionsRenderer && getDrivingOverviewPath().length >= 2 && !drawing;
    btnSubmit.disabled = !ok;
  } else {
    const ok = !!polyline && polyline.getPath && polyline.getPath().getLength() >= 2 && !drawing;
    btnSubmit.disabled = !ok;
  }
}

function updateInfo() {
  const countEl = document.getElementById('point-count');
  const lengthEl = document.getElementById('route-length');

  if (isDrivingMode()) {
    const path = getDrivingOverviewPath();
    countEl.textContent = String(path.length);
    const meters = getDrivingTotalMeters();
    lengthEl.textContent = `${Math.round(meters)} m`;
    refreshSubmitEnabled();
    return;
  }

  const path = polyline ? polyline.getPath().getArray().map(ll => ({ lat: ll.lat(), lng: ll.lng() })) : [];
  countEl.textContent = String(path.length);
  const meters = computePathLengthMeters(path);
  lengthEl.textContent = `${Math.round(meters)} m`;
  refreshSubmitEnabled();
}

function teardownListeners() {
  if (clickListener) {
    google.maps.event.removeListener(clickListener);
    clickListener = null;
  }
  if (moveListener) {
    google.maps.event.removeListener(moveListener);
    moveListener = null;
  }
  if (outListener) {
    google.maps.event.removeListener(outListener);
    outListener = null;
  }
}

function clearPreview() {
  if (previewLine) {
    previewLine.setMap(null);
    previewLine = null;
  }
}

function clearDriving() {
  if (directionsRenderer) {
    directionsRenderer.setMap(null);
    directionsRenderer = null;
  }
  drivingWaypoints = [];
}

function clearRoute() {
  if (isDrivingMode()) {
    clearDriving();
  }
  if (polyline) {
    polyline.setMap(null);
    polyline = null;
  }
  clearPreview();
  teardownListeners();
  drawing = false;
  setButtonsState('idle');
  updateInfo();
}

function ensureDirectionsObjects() {
  if (!directionsService) directionsService = new google.maps.DirectionsService();
  if (!directionsRenderer) {
    directionsRenderer = new google.maps.DirectionsRenderer({
      draggable: true,
      suppressMarkers: false,
      polylineOptions: { strokeColor: '#2563eb', strokeWeight: 5 }
    });
    directionsRenderer.setMap(map);
    directionsRenderer.addListener('directions_changed', () => {
      if (!drawing) updateInfo();
    });
  }
}

async function routeDriving() {
  if (drivingWaypoints.length < 2) {
    updateInfo();
    return;
  }
  ensureDirectionsObjects();
  const origin = drivingWaypoints[0];
  const destination = drivingWaypoints[drivingWaypoints.length - 1];
  const waypoints = drivingWaypoints.slice(1, -1).map(loc => ({ location: loc, stopover: true }));
  try {
    const result = await directionsService.route({
      origin,
      destination,
      waypoints,
      travelMode: google.maps.TravelMode.DRIVING,
      optimizeWaypoints: false,
      provideRouteAlternatives: false
    });
    directionsRenderer.setDirections(result);
    updateInfo();
  } catch (e) {
    console.error('Directions failed', e);
    refreshSubmitEnabled();
  }
}

function beginDrawing() {
  if (!map) return;
  drawing = true;
  setButtonsState('drawing');

  if (isDrivingMode()) {
    clearRoute(); // ensure clean start, but keep mode
    drawing = true;
    setButtonsState('drawing');
    ensureDirectionsObjects();
    drivingWaypoints = [];

    clickListener = map.addListener('click', (e) => {
      const ll = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      drivingWaypoints.push(ll);
      routeDriving();
    });

    // No preview line in driving mode
    return;
  }

  // Freehand mode
  if (!polyline) {
    polyline = new google.maps.Polyline({
      map,
      path: [],
      strokeColor: '#2563eb',
      strokeWeight: 4,
      clickable: false,
      editable: false
    });
  } else {
    polyline.setPath([]);
    polyline.setEditable(false);
  }

  clearPreview();

  // Create preview line (dashed) to show tentative segment to cursor
  previewLine = new google.maps.Polyline({
    map,
    path: [],
    strokeColor: '#2563eb',
    strokeOpacity: 0.6,
    strokeWeight: 3,
    clickable: false,
    icons: [{
      icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 4 },
      offset: '0',
      repeat: '12px'
    }]
  });

  // Add points on click
  clickListener = map.addListener('click', (e) => {
    const ll = e.latLng;
    polyline.getPath().push(ll);
    updateInfo();
  });

  // Live preview from last fixed vertex to cursor
  moveListener = map.addListener('mousemove', (e) => {
    const path = polyline.getPath();
    if (path.getLength() === 0) {
      previewLine.setPath([]);
      return;
    }
    const last = path.getAt(path.getLength() - 1);
    previewLine.setPath([last, e.latLng]);
  });

  // Clear preview when cursor leaves map container
  outListener = map.addListener('mouseout', () => {
    previewLine.setPath([]);
  });
}

function finishDrawing() {
  drawing = false;
  teardownListeners();
  clearPreview();

  if (isDrivingMode()) {
    ensureDirectionsObjects();
    setButtonsState('done');
    updateInfo();
    refreshSubmitEnabled();
    return;
  }

  if (polyline) {
    polyline.setEditable(true);
    polyline.addListener('mouseup', () => { updateInfo(); });
    polyline.addListener('insert_at', updateInfoFromPathEvent);
    polyline.addListener('remove_at', updateInfoFromPathEvent);
    polyline.addListener('set_at', updateInfoFromPathEvent);
  }

  setButtonsState('done');
  updateInfo();
  refreshSubmitEnabled();
}

function updateInfoFromPathEvent() {
  // For MVCArray change events where "this" is the polyline's path
  updateInfo();
}

function getRoutePath() {
  if (isDrivingMode()) {
    return getDrivingOverviewPath();
  }
  if (!polyline) return [];
  return polyline.getPath().getArray().map(ll => ({ lat: ll.lat(), lng: ll.lng() }));
}

async function submitRoute() {
  const path = getRoutePath();
  if (path.length < 2) {
    alert('Please draw a route with at least two points.');
    return;
  }
  const title = document.getElementById('title').value.trim();
  const description = document.getElementById('description').value.trim();

  const payload = {
    route: path,
    metadata: {
      title,
      description,
      center: map.getCenter() ? { lat: map.getCenter().lat(), lng: map.getCenter().lng() } : null,
      zoom: map.getZoom(),
      mode: isDrivingMode() ? 'driving' : 'freehand'
    }
  };

  const res = await fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (res.ok) {
    alert(`Thanks! Your submission id: ${data.id}`);
    clearRoute();
  } else {
    alert('Submission failed: ' + (data.error || 'Unknown error'));
  }
}

async function init() {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      alert('Google Maps API key missing on server.');
      return;
    }
    await loadGoogleMaps(apiKey);

    map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: 37.7749, lng: -122.4194 },
      zoom: 12,
      mapId: 'DEMO_MAP_ID'
    });

    drivingModeEl = document.getElementById('mode-driving');

    setButtonsState('idle');
    updateInfo();

    document.getElementById('btn-start').addEventListener('click', beginDrawing);
    document.getElementById('btn-finish').addEventListener('click', finishDrawing);
    document.getElementById('btn-clear').addEventListener('click', clearRoute);
    document.getElementById('btn-submit').addEventListener('click', submitRoute);

    const observer = new MutationObserver(() => {
      refreshSubmitEnabled();
    });
    observer.observe(document.getElementById('point-count'), { childList: true });

    if (drivingModeEl) {
      drivingModeEl.addEventListener('change', () => {
        clearRoute();
        refreshSubmitEnabled();
      });
    }

  } catch (e) {
    console.error(e);
    alert('Failed to initialize the map.');
  }
}

window.addEventListener('DOMContentLoaded', init);
