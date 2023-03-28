(function () {
    "use strict";
    let arrival_info = {};
    let problem_ids = [];
    let routes = {};
    let edges = {};
    let schedules = {}
    const avg_speed = 30;

    function update_arrival_info(map_features, routes, edges) {
        map_features.features.forEach(({properties}) => {
            arrival_info[properties.id] = {
                'id': properties.id,
                'name': properties.name,
                'description': properties.description.value,
                'route_length': {}
            }
        });

        Object.entries(routes).forEach(([busline_name, busline_stops]) => {
            let intermediate_distances = {};
            busline_stops.forEach((busstop_id, index, array) => {
                if (index === 0) {
                    arrival_info[busstop_id].route_length[busline_name] = 0;
                    intermediate_distances[busstop_id] = 0;
                    return;
                }
                const prev_busstop_id = array[index - 1];
                const edge_distance = edges[`${prev_busstop_id}-${busstop_id}`]
                intermediate_distances[busstop_id] = intermediate_distances[prev_busstop_id] + edge_distance;
                if (!edge_distance) {
                    console.error("EMPTY DISTANCE", busline_name, busstop_id, prev_busstop_id, arrival_info[busstop_id])
                    problem_ids.push(busstop_id)
                }
                arrival_info[busstop_id].route_length[busline_name] = intermediate_distances[busstop_id];
            })
        });
    }

    function onEachFeatureAddTooltip(feature, layer) {
        const props = arrival_info[feature.properties.id];
        layer.bindTooltip(`<p>${props.name}`);
    }

    function get_nearest_departures(schedules, line_name){
        const start = moment().add(-1, 'h');
        const stop = moment().add(1, 'h');
        return schedules[line_name].filter((time_item) => {
            return moment(time_item, "HH:mm").isBetween(start, stop);
        })
    }

    function get_arrive_time(departures, leg_time_minutes){
        return departures.map((time_item) => {
            return moment(time_item, "HH:mm").add(leg_time_minutes, "minutes").format("HH:mm");
        })
    }

    function onEachFeature(feature, layer) {
        var props = arrival_info[feature.properties.id];
        let popupContent = `<p>${props.name} [#${props.id}]<br/></p>`;

        if (feature.properties && feature.properties.popupContent) {
            popupContent += feature.properties.popupContent;
        }

        popupContent += Object.keys(props.route_length).map(line_name => {
            const length = props.route_length[line_name];
            const minutes = (length*60/avg_speed);
            const departures = get_nearest_departures(schedules, line_name);
            const arrive_time = get_arrive_time(departures, minutes).join("<br/>")
            return `${minutes.toFixed(1)} m. | ${line_name}: ${length.toFixed(1)} km. <br/>${arrive_time}`
        }).join("<br/><br/>")



        layer.bindPopup(popupContent).openPopup();
    }

    function init_bus_stops(map, busstops) {
        L.geoJSON(busstops, {
            style(feature) {
                return feature.properties && feature.properties.style;
            },
            onEachFeature: onEachFeatureAddTooltip,
            pointToLayer(feature, latlng) {
                const id = feature.properties.id;
                const is_issued = problem_ids.includes(id);

                return L.circleMarker(latlng, {
                    radius: 8,
                    fillColor: is_issued ? '#ff7800' : '#ff00ff',
                    color: '#000',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                });
            }
        }).on('click', ({sourceTarget, layer}) => onEachFeature(sourceTarget.feature, layer)).addTo(map)

    }


    function init() {
        const map = L.map('map').setView([42.45, 18.53], 13);

        L.control.ruler().addTo(map);
        L.control.locate({flyTo: true, returnToPrevBounds: true}).addTo(map);

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);

        Promise.all([
                '/hn_busstops.geojson',
                '/hn_routes.json',
            ].map(url => fetch(url).then(resp => resp.json()))
        ).then(function (data_files) {
            const [busstops, routes_data] = data_files;
            ({routes, edges, schedules} = routes_data);
            update_arrival_info(busstops, routes, edges)
            init_bus_stops(map, busstops);
            if (problem_ids.length) {
                console.log("problem_ids", problem_ids)
            }
        })
    }


    document.addEventListener("DOMContentLoaded", init);
})()
