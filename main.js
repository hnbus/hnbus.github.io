(function () {
    "use strict";
    let arrival_info = {};
    let problem_ids = [];
    let routes = {};
    let edges = {};
    let schedules = {}
    let sunday_schedules = {}
    let holiday_list = []
    let busstop_markers = {};
    let edge_speeds = {};
    let busstops, routes_data;
    let geoJsonLayer = null;
    let filterRouteOptions = new Set();
    let map;
    let cached_data = {};
    const site_state = {'busstop_id': 0, 'full_info': false};
    const is_localhost = (location.hostname === "localhost" || location.hostname === "127.0.0.1");

    function get_time_for_edge(edge_id, edge_length) {
        if (!edge_length) {
            return 0;
        }
        return edge_length * 60.0 / get_avgspeed(edge_id, edge_length);
    }

    function update_arrival_info(map_features, routes, edges) {
        map_features.features.forEach(({properties}) => {
            arrival_info[properties.id] = {
                'id': properties.id,
                'name': properties.name,
                'description': properties.description.value,
                'route_length': {},
                'route_time': {}
            }
        });

        Object.entries(routes).forEach(([busline_name, busline_stops]) => {
            let intermediate_distances = {};
            let intermediate_times = {};
            busline_stops.forEach((busstop_id, index, array) => {
                if (index === 0) {
                    arrival_info[busstop_id].route_length[busline_name] = 0;
                    arrival_info[busstop_id].route_time[busline_name] = 0;
                    intermediate_distances[busstop_id] = 0;
                    intermediate_times[busstop_id] = 0;
                    return;
                }
                const prev_busstop_id = array[index - 1];
                const edge_id = `${prev_busstop_id}-${busstop_id}`;
                const edge_distance = edges[edge_id]
                const curr_distance = intermediate_distances[prev_busstop_id] + edge_distance;
                const curr_time = intermediate_times[prev_busstop_id] + get_time_for_edge(edge_id, edge_distance);
                if (!edge_distance) {
                    console.error("EMPTY DISTANCE", busline_name, busstop_id, prev_busstop_id, arrival_info[busstop_id])
                    problem_ids.push(busstop_id)
                }

                intermediate_distances[busstop_id] = curr_distance;
                intermediate_times[busstop_id] = curr_time;
                arrival_info[busstop_id].route_length[busline_name] = curr_distance;
                arrival_info[busstop_id].route_time[busline_name] = curr_time;
            })
        });
    }

    function onEachFeatureAddTooltip(feature, layer) {
        const id = feature.properties.id;
        const props = arrival_info[id];
        layer.bindTooltip(`<p>${props.name} ${props.id}</p>`);
    }

    function get_nearest_departures(curr_schedule, line_name, full_info = false) {
        // const now = is_localhost ? moment().set('hour', 13) : moment()
        const now = moment()
        const start = full_info ? now.clone().set('hour', 0) : now.clone().add(-1, 'h');
        const stop = full_info ? now.clone().set('hour', 24) : now.clone().add(1, 'h');
        const line_schedule = curr_schedule[line_name];
        if (!line_schedule) {
            return [];
        }
        return curr_schedule[line_name].filter((time_item) => {
            const departure = moment(time_item, "HH:mm").set('date', now.date())
            return departure.isBetween(start, stop);
        })
    }

    function get_arrive_time(departures, leg_time_minutes) {
        return departures.map((time_item) => {
            return moment(time_item, "HH:mm").add(leg_time_minutes, "minutes").format("HH:mm");
        })
    }

    function get_avgspeed(edge_id, busstop_distance) {
        const edge_speed = edge_speeds[edge_id];
        if (edge_speed) {
            return edge_speed;
        }

        // if (busstop_distance < 0.35) {
        //     return 20.0;
        // }

        // if (busstop_distance < 0.7) {
        //     return 30.0;
        // }
        //
        // if (busstop_distance < 0.8) {
        //     return 40.0;
        // }


        return 37.0;
    }

    function onEachFeature(feature, layer) {
        const props = arrival_info[feature.properties.id];
        let popupContent = `<p><b>${props.name}</b> [${props.id}]</p>`;

        if (feature.properties && feature.properties.popupContent) {
            popupContent += feature.properties.popupContent;
        }



        let is_special_date = moment().day() === 0; // is Sunday
        if (!is_special_date) {
            const curr_date = moment().startOf('day');
            holiday_list.forEach((x) => {
                const holiday = moment(x, "DD.MM.YYYY").startOf('day');
                if (holiday.isSame(curr_date)) {
                    is_special_date = true;
                }
            })
        }

        const curr_schedule = is_special_date ? sunday_schedules : schedules;

        popupContent += Object.keys(props.route_length).map(line_name => {
            const length = props.route_length[line_name];
            const minutes = props.route_time[line_name];
            const departures = get_nearest_departures(curr_schedule, line_name, site_state.full_info);
            if (!departures.length) {
                return null;
            }
            const arrive_time = get_arrive_time(departures, minutes).join("<br/>")
            const popup_header = is_localhost ? `${line_name} | ${length.toFixed(1)} km. | ${minutes.toFixed(1)} m.` : `${line_name} `


            return `${popup_header}<br/><div class="${site_state.full_info ? 'multi' : ''}">${arrive_time}</div>`
        }).filter((x) => x !== null).join("<br/><br/>")

        if (is_localhost && feature.properties && feature.properties.lines) {
            popupContent += "<br/>" + feature.properties.lines.join("<br/>");
        }


        const div = document.createElement("div");
        div.innerHTML = `${popupContent}<br>`;

        const label = document.createElement("label");
        label.textContent = "Prikazati u celosti / Show full info";
        const checkbox = document.createElement('input');
        checkbox.setAttribute('type', 'checkbox');
        checkbox.checked = site_state.full_info;

        checkbox.addEventListener('change', (event) => {
            site_state.full_info = !!event.currentTarget.checked;
            onEachFeature(feature, layer);
        })
        label.appendChild(checkbox);
        div.appendChild(label);

        site_state.busstop_id = props.id;


        history.replaceState(site_state, "", `?id=${props.id}&full=${site_state.full_info}`);
        layer.bindPopup(div).openPopup();
    }

    function init_edges(map, edges) {
        Object.keys(edges).forEach((edge) => {
            const [start, stop] = edge.split('-').map(Number).map((busstop_id) => busstop_markers[busstop_id].getLatLng());
            var firstpolyline = new L.Polyline([start, stop], {
                color: 'blue',
                weight: 5,
                opacity: 1,
                smoothFactor: 1
            });
            firstpolyline.bindTooltip(`${edge} | ${edge_speeds[edge]}  ${edges[edge]} km`).addTo(map);
        })
    }

    function init_bus_stops(map, busstops) {
        geoJsonLayer = L.geoJSON(busstops, {
            style(feature) {
                return feature.properties && feature.properties.style;
            },
            filter: filterBySelectedRoute,
            onEachFeature: onEachFeatureAddTooltip,
            pointToLayer(feature, latlng) {
                const id = feature.properties.id;
                const is_issued = problem_ids.includes(id);

                const marker = L.circleMarker(latlng, {
                    radius: 10,
                    fillColor: is_issued ? '#ff7800' : '#ff00ff',
                    color: '#000',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                }).addTo(map);
                busstop_markers[id] = marker;
                return marker;

            }
        }).on('click', ({sourceTarget, layer}) => onEachFeature(sourceTarget.feature, layer)).addTo(map);

        return geoJsonLayer;
    }


    function filterBySelectedRoute(feature) {
        if (filterRouteOptions.size === 0){
            return true;
        }

        const featureOptions = new Set(Array.from(feature.properties.lines).map(x => x.split('.')[0]));
        const intersection = new Set([...filterRouteOptions].filter((x) => featureOptions.has(x)));
        return intersection.size > 0;
    }

    function onRouteChanged(event){
        filterRouteOptions = new Set(Array.from(event.target.selectedOptions).map(x => x.text.split('.')[0]));

        reloadGeoJson(map, false);
    }

    function getCachedOrFetch(url){
        if (url in cached_data){
            return cached_data[url];
        }
        return fetch(url).then(resp => resp.json()).then(function(data){
            cached_data[url] = data;
            return data;
        }
        )
    }

    function reloadGeoJson(map, on_start=false){
        map.eachLayer(function (layer) {
            if (layer._url){
                return
            }
            if (layer.options) {
                map.removeLayer(layer);
            }
        });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);

        Promise.all([
                '/hn_busstops.geojson',
                '/hn_routes.json',
            ].map(url => getCachedOrFetch(url))
        ).then(function (data_files) {
            [busstops, routes_data] = data_files;
            ({routes, edges, schedules, edge_speeds, holiday_list, sunday_schedules} = routes_data);
            update_arrival_info(busstops, routes, edges)

            if (problem_ids.length) {
                console.log("problem_ids", problem_ids)
            }
            return init_bus_stops(map, busstops);
        }).then(() => {
            if (!on_start){
                return;
            }

            const params = new URLSearchParams(window.location.search);

            const busstop_id = params.get('id');
            const full_info = params.get('full') == 'true';
            if (busstop_id) {
                site_state.busstop_id = busstop_id;
                site_state.full_info = full_info;
                const marker = busstop_markers[busstop_id];
                map.setView(marker.getLatLng(), 15);
                onEachFeature(marker.feature, marker)
            }
        }).then(() => {
            if (window.location.pathname === "/edges.html") {
                init_edges(map, edges);
            }
        })
    }

    function init(on_start=true) {
        map = L.map('map', {zoomControl: false}).setView([42.45, 18.53], 13);

        L.control.ruler({position: 'bottomright', flyTo: true}).addTo(map);
        L.control.zoom({position: 'bottomleft'}).addTo(map);
        L.control.locate({position: 'bottomleft', flyTo: true}).addTo(map);



        var routeSelect = document.querySelector('#routeSelect');
        routeSelect.addEventListener("change", onRouteChanged);

        reloadGeoJson(map, on_start)
    }

    document.addEventListener("DOMContentLoaded", init);
})()
