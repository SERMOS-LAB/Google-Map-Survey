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
let originAutocomplete = null;
let destinationAutocomplete = null;
let originMarker = null;
let destinationMarker = null;
let stopMarkers = [];
let originLatLng = null;
let destinationLatLng = null;
let drivingModeEl = null;
let drivingWaypoints = []; // array of LatLngLiteral for manual add (click to add stops)
let geocoder = null;

function computePathLengthMeters(path) {
  if (!window.google || !window.google.maps || !google.maps.geometry) return 0;
  const gPath = path.map(p => new google.maps.LatLng(p.lat, p.lng));
  return google.maps.geometry.spherical.computeLength(gPath);
}

function isDrivingMode() { return true; }

async function loadGoogleMaps(apiKey) {
  const existing = document.querySelector('script[data-google-maps]');
  if (existing) return;
  const url = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry,places`;
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
  const btnClear = document.getElementById('btn-clear');
  const btnSubmit = document.getElementById('btn-submit');
  if (!btnClear || !btnSubmit) return;

  if (state === 'idle') {
    btnClear.disabled = true;
    btnSubmit.disabled = true;
  } else if (state === 'drawing') {
    btnClear.disabled = false;
    btnSubmit.disabled = true;
  } else if (state === 'done') {
    btnClear.disabled = false;
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
  const btnClear = document.getElementById('btn-clear');
  if (!btnSubmit) return;
  const hasRoute = !!directionsRenderer && getDrivingOverviewPath().length >= 2 && !drawing;
  const ok = hasRoute;
  btnSubmit.disabled = !ok;
  if (btnClear) btnClear.disabled = !hasRoute;
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
  // Clear stop markers
  if (stopMarkers && stopMarkers.length) {
    stopMarkers.forEach(m => m.setMap(null));
    stopMarkers = [];
  }
  if (originMarker) { originMarker.setMap(null); originMarker = null; }
  if (destinationMarker) { destinationMarker.setMap(null); destinationMarker = null; }
  originLatLng = null;
  destinationLatLng = null;
}

function clearRoute() {
  clearDriving();
  if (polyline) { polyline.setMap(null); polyline = null; }
  clearPreview();
  teardownListeners();
  drawing = false;
  // Clear autocomplete input fields
  const originInput = document.getElementById('origin');
  const destinationInput = document.getElementById('destination');
  if (originInput) originInput.value = '';
  if (destinationInput) destinationInput.value = '';
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

async function routeWithPlaces(originLL, destinationLL) {
  ensureDirectionsObjects();
  try {
    const result = await directionsService.route({
      origin: originLL,
      destination: destinationLL,
      travelMode: google.maps.TravelMode.DRIVING,
      optimizeWaypoints: false,
      provideRouteAlternatives: false
    });
    directionsRenderer.setDirections(result);
    updateInfo();
  } catch (e) {
    console.error('Directions failed', e);
    alert('Failed to fetch driving directions for the selected places.');
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
    refreshSubmitEnabled();
  } catch (e) {
    console.error('Directions failed', e);
    refreshSubmitEnabled();
  }
}

function beginDrawing() { /* removed in driving-only workflow */ }

function finishDrawing() { /* removed in driving-only workflow */ }

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
    geocoder = new google.maps.Geocoder();

    // Places Autocomplete for origin/destination
    const originInput = document.getElementById('origin');
    const destinationInput = document.getElementById('destination');
    if (originInput && destinationInput && google.maps.places) {
      originAutocomplete = new google.maps.places.Autocomplete(originInput, { fields: ['geometry', 'name'] });
      destinationAutocomplete = new google.maps.places.Autocomplete(destinationInput, { fields: ['geometry', 'name'] });

      // Center the map when a place is chosen
      function centerOnPlace(place) {
        if (!place || !place.geometry) return;
        if (place.geometry.viewport) {
          map.fitBounds(place.geometry.viewport);
        } else if (place.geometry.location) {
          map.setCenter(place.geometry.location);
          map.setZoom(14);
        }
      }

      originAutocomplete.addListener('place_changed', () => {
        const p = originAutocomplete.getPlace();
        centerOnPlace(p);
        if (originMarker) { originMarker.setMap(null); }
        if (p && p.geometry && p.geometry.location) {
          originMarker = new google.maps.Marker({ position: p.geometry.location, map, label: 'A' });
          originLatLng = { lat: p.geometry.location.lat(), lng: p.geometry.location.lng() };
        }
        // If destination already chosen, auto route with current stops
        if (originLatLng && destinationLatLng) {
          drivingWaypoints = [originLatLng, ...drivingWaypoints.filter(() => true), destinationLatLng];
          routeDriving();
        }
      });

      destinationAutocomplete.addListener('place_changed', () => {
        const p = destinationAutocomplete.getPlace();
        centerOnPlace(p);
        if (destinationMarker) { destinationMarker.setMap(null); }
        if (p && p.geometry && p.geometry.location) {
          destinationMarker = new google.maps.Marker({ position: p.geometry.location, map, label: 'B' });
          destinationLatLng = { lat: p.geometry.location.lat(), lng: p.geometry.location.lng() };
        }
        if (originLatLng && destinationLatLng) {
          drivingWaypoints = [originLatLng, ...drivingWaypoints.filter(() => true), destinationLatLng];
          routeDriving();
        }
      });

      document.getElementById('btn-route')?.addEventListener('click', async () => {
        const oPlace = originAutocomplete.getPlace();
        const dPlace = destinationAutocomplete.getPlace();
        const origin = oPlace && oPlace.geometry ? oPlace.geometry.location : null;
        const destination = dPlace && dPlace.geometry ? dPlace.geometry.location : null;
        if (!origin || !destination) {
          alert('Please choose both origin and destination from the suggestions.');
          return;
        }
        drivingModeEl = document.getElementById('mode-driving');
        if (drivingModeEl) drivingModeEl.checked = true;
        await routeWithPlaces({ lat: origin.lat(), lng: origin.lng() }, { lat: destination.lat(), lng: destination.lng() });
      });
    }

    drivingModeEl = { checked: true };

    setButtonsState('idle');
    updateInfo();

    document.getElementById('btn-clear').addEventListener('click', clearRoute);
    document.getElementById('btn-submit').addEventListener('click', submitRoute);

    const observer = new MutationObserver(() => {
      refreshSubmitEnabled();
    });
    observer.observe(document.getElementById('point-count'), { childList: true });

  // In driving-only mode, clicking on the map adds a stop and re-routes
    map.addListener('click', async (e) => {
      const ll = { lat: e.latLng.lat(), lng: e.latLng.lng() };
    // If origin not set, set as origin
    if (!originLatLng) {
      originLatLng = ll;
      if (originMarker) originMarker.setMap(null);
      originMarker = new google.maps.Marker({ position: ll, map, label: 'A' });
      // Populate origin input via reverse geocoding
      try {
        if (geocoder) {
          const res = await geocoder.geocode({ location: ll });
          const addr = res.results && res.results[0] ? res.results[0].formatted_address : '';
          const originInput = document.getElementById('origin');
          if (originInput && addr) originInput.value = addr;
        }
      } catch {}
      return;
    }
    // If destination not set, set as destination and route
    if (!destinationLatLng) {
      destinationLatLng = ll;
      if (destinationMarker) destinationMarker.setMap(null);
      destinationMarker = new google.maps.Marker({ position: ll, map, label: 'B' });
      // Populate destination input via reverse geocoding
      try {
        if (geocoder) {
          const res = await geocoder.geocode({ location: ll });
          const addr = res.results && res.results[0] ? res.results[0].formatted_address : '';
          const destinationInput = document.getElementById('destination');
          if (destinationInput && addr) destinationInput.value = addr;
        }
      } catch {}
      drivingWaypoints = [originLatLng, destinationLatLng];
      await routeDriving();
      return;
    }
    // Otherwise, add as an intermediate stop before destination
    const stopMarker = new google.maps.Marker({ position: ll, map });
    stopMarkers.push(stopMarker);
    // Rebuild waypoints = origin + existing stops + new stop + destination
    const stops = stopMarkers.map(m => ({ lat: m.getPosition().lat(), lng: m.getPosition().lng() }));
    drivingWaypoints = [originLatLng, ...stops, destinationLatLng];
    await routeDriving();
    });

  } catch (e) {
    console.error(e);
    alert('Failed to initialize the map.');
  }
}

window.addEventListener('DOMContentLoaded', init);
