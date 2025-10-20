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
let privacyChoice = 'exact'; // Track user's privacy preference
let typedStops = []; // Array of typed stops with placeId, name, coordinates
let lastAutoRoute = null; // Store the last auto-generated route

function computePathLengthMeters(path) {
  if (!window.google || !window.google.maps || !google.maps.geometry) return 0;
  const gPath = path.map(p => new google.maps.LatLng(p.lat, p.lng));
  return google.maps.geometry.spherical.computeLength(gPath);
}

function isDrivingMode() { return true; }

// Typed stops management
function addTypedStop(place) {
  if (!place || !place.geometry) return;
  
  const stop = {
    id: Date.now(), // Simple unique ID
    name: place.name || place.formatted_address || 'Unknown Place',
    placeId: place.place_id,
    lat: place.geometry.location.lat(),
    lng: place.geometry.location.lng()
  };
  
  typedStops.push(stop);
  updateStopsDisplay();
  updateRouteWithTypedStops();
}

function removeTypedStop(stopId) {
  const stopIndex = typedStops.findIndex(stop => stop.id === stopId);
  if (stopIndex === -1) return;
  
  const stop = typedStops[stopIndex];
  
  // If it's a click stop, remove the corresponding marker
  if (stop.isClickStop) {
    const markerIndex = stopMarkers.findIndex(m => 
      Math.abs(m.getPosition().lat() - stop.lat) < 0.0001 && 
      Math.abs(m.getPosition().lng() - stop.lng) < 0.0001
    );
    if (markerIndex !== -1) {
      stopMarkers[markerIndex].setMap(null);
      stopMarkers.splice(markerIndex, 1);
    }
  }
  
  typedStops.splice(stopIndex, 1);
  updateStopsDisplay();
  updateRouteWithTypedStops();
}

function updateStopsDisplay() {
  const container = document.getElementById('stops-list');
  container.innerHTML = '';
  
  // Clear any existing numbered stop markers
  stopMarkers.forEach(m => m.setMap && m.setMap(null));
  stopMarkers = [];

  typedStops.forEach((stop, index) => {
    const stopDiv = document.createElement('div');
    stopDiv.className = 'stop-item';
    stopDiv.setAttribute('data-id', String(stop.id));
    stopDiv.innerHTML = `
      <div class="drag-handle" title="Drag to reorder" draggable="true">≡</div>
      <div class="stop-number">${index + 1}</div>
      <div class="stop-name">${stop.name}</div>
      <button class="stop-remove" data-id="${stop.id}">×</button>
    `;
    container.appendChild(stopDiv);

    // Add/refresh numbered marker on map
    const marker = new google.maps.Marker({ position: { lat: stop.lat, lng: stop.lng }, map, label: String(index + 1) });
    stopMarkers.push(marker);
  });

  // Delegate remove button
  container.querySelectorAll('.stop-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = Number(btn.getAttribute('data-id'));
      removeTypedStop(id);
    });
  });

  // Drag-and-drop reorder with visual feedback
  const handles = Array.from(container.querySelectorAll('.drag-handle'));
  const items = Array.from(container.querySelectorAll('.stop-item'));
  
  handles.forEach(handle => {
    handle.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.stop-item');
      e.dataTransfer.setData('text/plain', item.getAttribute('data-id'));
      item.classList.add('dragging');
    });
    
    handle.addEventListener('dragend', (e) => {
      const item = e.target.closest('.stop-item');
      item.classList.remove('dragging');
    });
  });
  
  items.forEach(item => {
    item.addEventListener('dragover', (e) => { 
      e.preventDefault(); 
      e.dataTransfer.dropEffect = 'move';
      
      const draggedId = Number(e.dataTransfer.getData('text/plain'));
      const targetId = Number(item.getAttribute('data-id'));
      
      if (draggedId !== targetId) {
        item.classList.add('drag-over');
      }
    });
    
    item.addEventListener('dragleave', (e) => {
      item.classList.remove('drag-over');
    });
    
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      
      const draggedId = Number(e.dataTransfer.getData('text/plain'));
      const targetId = Number(item.getAttribute('data-id'));
      if (draggedId === targetId) return;
      
      const fromIdx = typedStops.findIndex(s => s.id === draggedId);
      const toIdx = typedStops.findIndex(s => s.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return;
      
      const [moved] = typedStops.splice(fromIdx, 1);
      typedStops.splice(toIdx, 0, moved);
      updateStopsDisplay();
      updateRouteWithTypedStops();
    });
  });
}

function updateRouteWithTypedStops() {
  if (!originLatLng || !destinationLatLng) return;
  
  // Combine typed stops and click stops
  const allStops = typedStops.map(stop => ({ lat: stop.lat, lng: stop.lng }));
  drivingWaypoints = [originLatLng, ...allStops, destinationLatLng];
  routeDriving();
}

function revertToAutoRoute() {
  if (!lastAutoRoute || !originLatLng || !destinationLatLng) return;
  
  // Clear all stops
  typedStops = [];
  stopMarkers.forEach(m => m.setMap(null));
  stopMarkers = [];
  updateStopsDisplay();
  
  // Restore auto route
  drivingWaypoints = [originLatLng, destinationLatLng];
  routeDriving();
}

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
  const btnRevert = document.getElementById('btn-revert');
  if (!btnSubmit) return;
  const hasRoute = !!directionsRenderer && getDrivingOverviewPath().length >= 2 && !drawing;
  const ok = hasRoute;
  btnSubmit.disabled = !ok;
  if (btnClear) btnClear.disabled = !hasRoute;
  if (btnRevert) btnRevert.disabled = !hasRoute || !lastAutoRoute;
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
  typedStops = []; // Clear typed stops
  updateStopsDisplay(); // Update the display
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
      suppressMarkers: true,
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

    // Show instruction modal first
    const modal = document.getElementById('instruction-modal');
    const startButton = document.getElementById('start-mapping');
    const showInstructionsButton = document.getElementById('show-instructions');
    
    startButton.addEventListener('click', () => {
      // Get privacy choice
      const privacyRadios = document.querySelectorAll('input[name="privacy"]');
      privacyRadios.forEach(radio => {
        if (radio.checked) {
          privacyChoice = radio.value;
        }
      });
      
      // Hide modal
      modal.classList.add('hidden');
      
      // Only initialize map if it hasn't been initialized yet
      if (!map) {
        initializeMap();
      }
    });

    // Show instructions button functionality
    if (showInstructionsButton) {
      showInstructionsButton.addEventListener('click', () => {
        modal.classList.remove('hidden');
      });
    }

  } catch (e) {
    console.error(e);
    alert('Failed to initialize the map.');
  }
}

function initializeMap() {
  try {
    map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: 34.0522, lng: -118.2437 }, // Los Angeles coordinates
      zoom: 10,
      mapId: 'DEMO_MAP_ID',
      zoomControl: true,
      zoomControlOptions: {
        position: google.maps.ControlPosition.TOP_LEFT
      }
    });
    geocoder = new google.maps.Geocoder();

    // Responsive: move zoom controls on small screens
    function applyResponsiveMapUI() {
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      map.setOptions({
        zoomControlOptions: {
          position: isMobile ? google.maps.ControlPosition.RIGHT_BOTTOM : google.maps.ControlPosition.TOP_LEFT
        }
      });
    }
    applyResponsiveMapUI();
    window.addEventListener('resize', applyResponsiveMapUI);

    // Mobile toggle for stops sidebar
    const sidebar = document.getElementById('stops-sidebar');
    const toggleStopsBtn = document.getElementById('toggle-stops');
    if (toggleStopsBtn && sidebar) {
      toggleStopsBtn.addEventListener('click', () => {
        const hidden = sidebar.classList.toggle('hidden');
        toggleStopsBtn.textContent = hidden ? 'Show' : 'Hide';
      });
    }

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
          // Store this as the auto route
          lastAutoRoute = { origin: originLatLng, destination: destinationLatLng };
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
          // Store this as the auto route
          lastAutoRoute = { origin: originLatLng, destination: destinationLatLng };
        }
      });
    }

    drivingModeEl = { checked: true };

    setButtonsState('idle');
    updateInfo();

    document.getElementById('btn-clear').addEventListener('click', clearRoute);
    document.getElementById('btn-submit').addEventListener('click', submitRoute);
    document.getElementById('btn-revert').addEventListener('click', revertToAutoRoute);
    
    // Add Stop button functionality
    document.getElementById('add-stop').addEventListener('click', () => {
      const stopModal = document.getElementById('stop-modal');
      const stopSearch = document.getElementById('stop-search');
      const confirmBtn = document.getElementById('confirm-stop');
      const cancelBtn = document.getElementById('cancel-stop');
      
      stopModal.classList.remove('hidden');
      stopSearch.value = '';
      confirmBtn.disabled = true;
      
      // Set up Places Autocomplete for stop search
      const stopAutocomplete = new google.maps.places.Autocomplete(stopSearch, { 
        fields: ['geometry', 'name', 'place_id', 'formatted_address']
      });
      // Keep suggestions near current map viewport
      function bindStopAutocompleteBias() {
        const bounds = map.getBounds();
        if (bounds) stopAutocomplete.setBounds(bounds);
      }
      bindStopAutocompleteBias();
      map.addListener('idle', bindStopAutocompleteBias);
      window.addEventListener('resize', bindStopAutocompleteBias);
      
      stopAutocomplete.addListener('place_changed', () => {
        const place = stopAutocomplete.getPlace();
        if (place && place.geometry) {
          confirmBtn.disabled = false;
          confirmBtn.onclick = () => {
            addTypedStop(place);
            stopModal.classList.add('hidden');
          };
        }
      });
      
      cancelBtn.onclick = () => {
        stopModal.classList.add('hidden');
      };
    });

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
        // Store this as the auto route
        lastAutoRoute = { origin: originLatLng, destination: destinationLatLng };
        return;
      }
      // Otherwise, add as an intermediate stop before destination
      let stopName = `Stop ${typedStops.length + 1}`;
      
      // Try to get a better name via reverse geocoding
      try {
        if (geocoder) {
          const res = await geocoder.geocode({ location: ll });
          if (res.results && res.results[0]) {
            const addr = res.results[0].formatted_address;
            // Use a shorter, more readable name
            const parts = addr.split(',');
            if (parts.length > 1) {
              stopName = parts[0].trim(); // Use first part (street address or place name)
            } else {
              stopName = addr;
            }
          }
        }
      } catch (e) {
        console.log('Reverse geocoding failed, using default name');
      }
      
      const stop = {
        id: Date.now(),
        name: stopName,
        placeId: null,
        lat: ll.lat,
        lng: ll.lng,
        isClickStop: true
      };
      typedStops.push(stop);
      updateStopsDisplay();
      updateRouteWithTypedStops();
    });

  } catch (e) {
    console.error(e);
    alert('Failed to initialize the map.');
  }
}

window.addEventListener('DOMContentLoaded', init);
