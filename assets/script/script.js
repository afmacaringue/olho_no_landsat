document.addEventListener("DOMContentLoaded", function () {
  // Inicializar o mapa
  const map = L.map("map").setView([0, 0], 2);

  // Adicionar camada do mapa
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // Variáveis para armazenar a localização e marcadores
  let userMarker = null;
  let userPosition = null;
  let satelliteMarkers = [];
  let updateInterval = null;

  // Elementos da UI
  const getLocationBtn = document.getElementById("getLocationBtn");
  const locationInfo = document.getElementById("locationInfo");
  const loadingSpinner = document.getElementById("loadingSpinner");
  const calculationCard = document.getElementById("calculationCard");
  const satelliteSelect = document.getElementById("satelliteSelect");
  const calculateBtn = document.getElementById("calculateBtn");
  const calculationResults = document.getElementById("calculationResults");

  // Dados TLE (Two-Line Element) para Landsat 8 e 9 (atualizados periodicamente)
  const satelliteData = {
    "Landsat 8": {
      tle1: "1 39084U 13008A   25211.17113308  .00000344  00000-0  86359-4 0  9997",
      tle2: "2 39084  98.2234 281.1159 0001236  89.8938 270.2402 14.57113439662827",
      marker: null,
      satrec: null,
    },
    "Landsat 9": {
      tle1: "1 49260U 21088A   23256.48693210  .00000142  00000-0  48706-4 0  9991",
      tle2: "2 49260  98.2100 184.9175 0001256  92.3065 267.8408 14.57110519316513",
      marker: null,
      satrec: null,
    },
  };

  // Inicializar os objetos satellite.js
  function initializeSatelliteObjects() {
    Object.keys(satelliteData).forEach((name) => {
      const sat = satelliteData[name];
      sat.satrec = satellite.twoline2satrec(sat.tle1, sat.tle2);
    });
  }

  // Calcular a posição atual de um satélite
  function calculateSatellitePosition(satrec) {
    const date = new Date();
    const positionAndVelocity = satellite.propagate(satrec, date);

    if (positionAndVelocity.position === false) {
      return null;
    }

    const gmst = satellite.gstime(date);
    const positionGd = satellite.eciToGeodetic(
      positionAndVelocity.position,
      gmst
    );

    const longitude = satellite.degreesLong(positionGd.longitude);
    const latitude = satellite.degreesLat(positionGd.latitude);
    const altitude = positionGd.height;

    return {
      lat: latitude,
      lng: longitude,
      alt: altitude,
      velocity: positionAndVelocity.velocity,
    };
  }

  // Calcular distância entre duas coordenadas geográficas (em km)
  function calculateDistance(pos1, pos2) {
    const lat1 = (pos1.lat * Math.PI) / 180;
    const lon1 = (pos1.lng * Math.PI) / 180;
    const lat2 = (pos2.lat * Math.PI) / 180;
    const lon2 = (pos2.lng * Math.PI) / 180;

    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // Raio da Terra em km
    const earthRadius = 6371;
    return earthRadius * c;
  }

  // Calcular azimute entre duas coordenadas geográficas (em graus)
  function calculateAzimuth(pos1, pos2) {
    const lat1 = (pos1.lat * Math.PI) / 180;
    const lon1 = (pos1.lng * Math.PI) / 180;
    const lat2 = (pos2.lat * Math.PI) / 180;
    const lon2 = (pos2.lng * Math.PI) / 180;

    const dLon = lon2 - lon1;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let azimuth = (Math.atan2(y, x) * 180) / Math.PI;

    // Converter para 0-360 graus
    if (azimuth < 0) {
      azimuth += 360;
    }

    return azimuth;
  }

  // Calcular elevação (em graus)
  function calculateElevation(pos1, pos2, distance) {
    const lat1 = (pos1.lat * Math.PI) / 180;
    const lon1 = (pos1.lng * Math.PI) / 180;
    const lat2 = (pos2.lat * Math.PI) / 180;
    const lon2 = (pos2.lng * Math.PI) / 180;

    // Raio da Terra em km
    const earthRadius = 6371;

    // Altura do satélite em km
    const h = pos2.alt;

    // Distância angular (radianos)
    const centralAngle = distance / earthRadius;

    // Cálculo da elevação
    const term1 = (earthRadius + h) * Math.sin(centralAngle);
    const term2 = earthRadius * (1 - Math.cos(centralAngle));
    const elevation = Math.atan2(term1 - term2, distance);

    return (elevation * 180) / Math.PI;
  }

  // Calcular velocidade angular (graus/segundo)
  function calculateAngularVelocity(pos1, pos2, velocity) {
    // Velocidade em km/s
    const speed = Math.sqrt(
      velocity.x * velocity.x +
        velocity.y * velocity.y +
        velocity.z * velocity.z
    );

    // Distância em km
    const distance = calculateDistance(pos1, pos2);

    // Velocidade angular em radianos/segundo
    const angularVelocity = speed / distance;

    // Converter para graus/segundo
    return (angularVelocity * 180) / Math.PI;
  }

  // Atualizar as posições dos satélites no mapa
  function updateSatellitePositions() {
    Object.keys(satelliteData).forEach((name) => {
      const sat = satelliteData[name];
      const position = calculateSatellitePosition(sat.satrec);

      if (position) {
        if (sat.marker) {
          sat.marker.setLatLng([position.lat, position.lng]);
          sat.marker.setPopupContent(`
                                <b>${name}</b><br>
                                Latitude: ${position.lat.toFixed(4)}°<br>
                                Longitude: ${position.lng.toFixed(4)}°<br>
                                Altitude: ${position.alt.toFixed(2)} km<br>
                                Velocidade: ~7.5 km/s<br>
                                Última atualização: ${new Date().toLocaleTimeString()}
                            `);
        } else {
          // Criar marcador do satélite
          const satelliteIcon = L.divIcon({
            className: "satellite-icon",
            html: `<i class="fas fa-satellite" style="color: #1b5e20; font-size: 20px;"></i>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });

          sat.marker = L.marker([position.lat, position.lng], {
            icon: satelliteIcon,
          }).addTo(map).bindPopup(`
                                <b>${name}</b><br>
                                Latitude: ${position.lat.toFixed(4)}°<br>
                                Longitude: ${position.lng.toFixed(4)}°<br>
                                Altitude: ${position.alt.toFixed(2)} km<br>
                                Velocidade: ~7.5 km/s
                            `);

          satelliteMarkers.push(sat.marker);
        }
      }
    });
  }

  // Função para calcular e exibir os resultados astronômicos
  function calculateAndDisplayResults() {
    if (!userPosition) {
      alert("Por favor, obtenha sua localização primeiro");
      return;
    }

    const selectedSatellite = satelliteSelect.value;
    const sat = satelliteData[selectedSatellite];

    if (!sat) {
      alert("Satélite não encontrado");
      return;
    }

    const satPos = calculateSatellitePosition(sat.satrec);

    if (!satPos) {
      alert("Não foi possível calcular a posição do satélite");
      return;
    }

    // Realizar todos os cálculos
    const distance = calculateDistance(userPosition, satPos);
    const azimuth = calculateAzimuth(userPosition, satPos);
    const elevation = calculateElevation(userPosition, satPos, distance);
    const angularVelocity = calculateAngularVelocity(
      userPosition,
      satPos,
      satPos.velocity
    );

    // Formatar os resultados
    const resultsText = `
=== CÁLCULOS ASTRONÔMICOS ===
Data/Hora: ${new Date().toLocaleString("pt-BR")}

[POSIÇÕES]
Sua Localização:
  Latitude:  ${userPosition.lat.toFixed(6)}°
  Longitude: ${userPosition.lng.toFixed(6)}°

Satélite ${selectedSatellite}:
  Latitude:  ${satPos.lat.toFixed(6)}°
  Longitude: ${satPos.lng.toFixed(6)}°
  Altitude:  ${satPos.alt.toFixed(2)} km

[RESULTADOS]
Distância:       ${distance.toFixed(2)} km
Azimute:         ${azimuth.toFixed(2)}°
Elevação:        ${elevation.toFixed(2)}°
Velocidade Angular: ${angularVelocity.toFixed(6)}°/s
                `;

    // Exibir os resultados
    calculationResults.textContent = resultsText;
  }

  // Função para obter a localização do usuário
  function getUserLocation() {
    loadingSpinner.style.display = "block";
    getLocationBtn.disabled = true;

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function (position) {
          userPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };

          // Atualizar informações de localização
          locationInfo.innerHTML = `
                                <h5><i class="fas fa-map-marker-alt text-success me-2"></i>Sua Localização</h5>
                                <p><strong>Latitude:</strong> ${userPosition.lat.toFixed(
                                  6
                                )}</p>
                                <p><strong>Longitude:</strong> ${userPosition.lng.toFixed(
                                  6
                                )}</p>
                                <p><strong>Precisão:</strong> ${position.coords.accuracy.toFixed(
                                  2
                                )} metros</p>
                                <p><strong>Última atualização:</strong> ${new Date().toLocaleTimeString()}</p>
                            `;

          // Centralizar o mapa na localização do usuário
          map.setView([userPosition.lat, userPosition.lng], 5);

          // Adicionar/atualizar marcador do usuário
          if (userMarker) {
            userMarker.setLatLng([userPosition.lat, userPosition.lng]);
          } else {
            userMarker = L.marker([userPosition.lat, userPosition.lng], {
              icon: L.divIcon({
                className: "user-icon",
                html: '<i class="fas fa-user" style="color: #2e7d32; font-size: 24px;"></i>',
                iconSize: [24, 24],
                iconAnchor: [12, 12],
              }),
            })
              .addTo(map)
              .bindPopup("Sua localização atual");
          }

          // Mostrar o card de cálculos
          calculationCard.style.display = "block";

          loadingSpinner.style.display = "none";
          getLocationBtn.disabled = false;
        },
        function (error) {
          let errorMessage;
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = "Permissão para acessar a localização foi negada.";
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage =
                "Informações de localização não estão disponíveis.";
              break;
            case error.TIMEOUT:
              errorMessage = "A solicitação para obter a localização expirou.";
              break;
            case error.UNKNOWN_ERROR:
              errorMessage =
                "Ocorreu um erro desconhecido ao obter a localização.";
              break;
          }

          locationInfo.innerHTML = `
                                <div class="alert alert-danger">
                                    <i class="fas fa-exclamation-triangle me-2"></i>${errorMessage}
                                </div>
                            `;

          loadingSpinner.style.display = "none";
          getLocationBtn.disabled = false;
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    } else {
      locationInfo.innerHTML = `
                        <div class="alert alert-warning">
                            <i class="fas fa-exclamation-triangle me-2"></i>Geolocalização não é suportada pelo seu navegador.
                        </div>
                    `;
      loadingSpinner.style.display = "none";
      getLocationBtn.disabled = false;
    }
  }

  // Inicializar os objetos de satélite
  initializeSatelliteObjects();

  // Atualizar as posições dos satélites a cada 10 segundos
  updateSatellitePositions();
  updateInterval = setInterval(updateSatellitePositions, 10000);

  // Event listeners
  getLocationBtn.addEventListener("click", getUserLocation);
  calculateBtn.addEventListener("click", calculateAndDisplayResults);

  // Limpar intervalo quando a página for fechada
  window.addEventListener("beforeunload", function () {
    if (updateInterval) {
      clearInterval(updateInterval);
    }
  });
});
