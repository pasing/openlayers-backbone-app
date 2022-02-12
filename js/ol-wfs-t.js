const projection = new ol.proj.Projection({
    code: 'EPSG:3857',
    units: 'm',
    axisOrientation: 'neu'
});

const formatWFS = new ol.format.WFS();

const formatGML = new ol.format.GML({
    featureNS: 'http://127.0.0.1:8080/geoserver/geodata',
    featureType: 'stazioni_campania',
    srsName: 'EPSG:3857'
});

let xs = new XMLSerializer();

const username = 'admin';
const password = 'geoserver';

function make_base_auth(user, password) {
    let tok = user + ':' + password;
    let hash = btoa(tok);
    return 'Basic ' + hash;
}

const loaderWFS = function(extent, resolution, projection, success, failure) {
    let proj = projection.getCode();
    console.log('epsg code > ', proj)
    let url = 'http://127.0.0.1:8080/geoserver/geodata/wfs?service=WFS&' +
        'version=1.1.0&request=GetFeature&typename=geodata:stazioni_campania&' +
        'outputFormat=application/json&srsname=' + proj + '&' +
        'bbox=' + extent.join(',') + ',' + proj;
    let xhr = new XMLHttpRequest();
    xhr.open('GET', url);

    xhr.setRequestHeader('Authorization', make_base_auth(username, password));
    console.log('xhr > ', xhr, 'basic > ', make_base_auth(username, password))
    let onError = function() {
        sourceWFS.removeLoadedExtent(extent);
        failure();
    }
    xhr.onerror = onError;
    xhr.onload = function() {
        if (xhr.status === 200) {
            console.log('response 200 > ', xhr.responseText)
            let features = sourceWFS.getFormat().readFeatures(xhr.responseText);
            sourceWFS.addFeatures(features);
            success(features);
        } else {
            console.log('response ko > ', xhr.responseText)
            onError();
        }
    }
    xhr.send();
};

const sourceWFS = new ol.source.Vector({
    format: new ol.format.GeoJSON(),
    loader: loaderWFS,
    strategy: ol.loadingstrategy.bbox
});

const layerWFS = new ol.layer.Vector({
    source: sourceWFS,
    style: new ol.style.Style({
        image: new ol.style.Circle({
            fill: new ol.style.Fill({
                color: 'rgba(0, 0, 0, 0.2)',
            }),
            stoke: new ol.style.Stroke({
                color: 'rgba(0, 0, 0, 1.0)',
                width: 2
            }),
            radius: 5
        })
    })
});

let interaction;

let interactionSelectPointerMove = new ol.interaction.Select({
    condition: ol.events.condition.pointerMove
});

let interactionSelect = new ol.interaction.Select({
    style: new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: '#FF2828'
        })
    })
});

let interactionSnap = new ol.interaction.Snap({
    source: layerWFS.getSource()
});

const raster = new ol.layer.Tile({
    source: new ol.source.OSM({
        url: 'https://cartodb-basemaps-{a-d}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png',
        opaque: false,
        attributions: []
    })
});

const map = new ol.Map({
    target: 'map',
    controls: [],
    interactions: [
        interactionSelectPointerMove,
        new ol.interaction.MouseWheelZoom(),
        new ol.interaction.DragPan()
    ],
    layers: [
        raster,
        layerWFS
    ],
    view: new ol.View({
        projection: projection,
        center: ol.proj.transform([14.80, 40.80], 'EPSG:4326', 'EPSG:3857'),
        maxZoom: 19,
        zoom: 9
    })
});

//wfs-t
let dirty = {};
let transactWFS = function (mode, f) {
    let node;
    switch (mode) {
        case 'insert':
            node = formatWFS.writeTransaction([f], null, null, formatGML);
            break;
        case 'update':
            node = formatWFS.writeTransaction(null, [f], null, formatGML);
            break;
        case 'delete':
            node = formatWFS.writeTransaction(null, null, [f], formatGML);
            break;
    }
    let payload = xs.serializeToString(node);
    $.ajax('http://127.0.0.1:8080/geoserver/geodata/ows', {
        type: 'POST',
        dataType: 'xml',
        processData: false,
        contentType: 'text/xml',
        data: payload
    }).done(function () {
        sourceWFS.clear();
    });
};

$('button').click(function () {
    $(this).siblings().removeClass('btn-active');
    $(this).addClass('btn-active');
    map.removeInteraction(interaction);
    interactionSelect.getFeatures().clear();
    map.removeInteraction(interactionSelect);

    switch ($(this).attr('id')) {

        case 'btnEdit':
            map.addInteraction(interactionSelect);
            interaction = new ol.interaction.Modify({
                features: interactionSelect.getFeatures()
            });
            map.addInteraction(interaction);
            map.addInteraction(interactionSnap);
            dirty = {};
            interactionSelect.getFeatures().on('add', function (e) {
                e.element.on('change', function (e) {
                    dirty[e.target.getId()] = true;
                });
            });
            interactionSelect.getFeatures().on('remove', function (e) {
                var f = e.element;
                if (dirty[f.getId()]) {
                    delete dirty[f.getId()];
                    var featureProperties = f.getProperties();
                    delete featureProperties.boundedBy;
                    var clone = new ol.Feature(featureProperties);
                    clone.setId(f.getId());
                    transactWFS('update', clone);
                }
            });
            break;

        case 'btnPoint':
            interaction = new ol.interaction.Draw({
                type: 'Point',
                source: layerWFS.getSource()
            });
            map.addInteraction(interaction);
            interaction.on('drawend', function (e) {
                transactWFS('insert', e.feature);
            });
            break;

        case 'btnLine':
            interaction = new ol.interaction.Draw({
                type: 'LineString',
                source: layerWFS.getSource()
            });
            map.addInteraction(interaction);
            interaction.on('drawend', function (e) {
                transactWFS('insert', e.feature);
            });
            break;

        case 'btnArea':
            interaction = new ol.interaction.Draw({
                type: 'Polygon',
                source: layerWFS.getSource()
            });
            interaction.on('drawend', function (e) {
                transactWFS('insert', e.feature);
            });
            map.addInteraction(interaction);
            break;

        case 'btnDelete':
            interaction = new ol.interaction.Select();
            interaction.getFeatures().on('add', function (e) {
                transactWFS('delete', e.target.item(0));
                interactionSelectPointerMove.getFeatures().clear();
                interaction.getFeatures().clear();
            });
            map.addInteraction(interaction);
            break;

        default:
            break;
    }
});

$('#btnZoomIn').on('click', function () {
    let view = map.getView();
    let newResolution = view.constrainResolution(view.getResolution(), 1);
    view.setResolution(newResolution);
});

$('#btnZoomOut').on('click', function () {
    let view = map.getView();
    let newResolution = view.constrainResolution(view.getResolution(), -1);
    view.setResolution(newResolution);
});
