var projection = new ol.proj.Projection({
    code: 'EPSG:3857',
    units: 'm',
    axisOrientation: 'neu'
});

var formatWFS = new ol.format.WFS();

var formatGML = new ol.format.GML({
    featureNS: 'http://geocatalogue.databenc.it/geoserver/chis_test',
    featureType: 'wfs_geom',
    srsName: 'EPSG:3857'
});

var xs = new XMLSerializer();

/*var sourceWFS = new ol.source.Vector({
    loader: function (extent) {
        $.ajax('http://geocatalogue.databenc.it/geoserver/chis_test/ows', {
            type: 'GET',
            data: {
                service: 'WFS',
                version: '1.0.0',
                request: 'GetFeature',
                typeName: 'chis_test:wfs_geom',
                srsName: 'EPSG:3857',
                //cql_filter: "property='Value'",
                //cql_filter: "BBOX(geometry," + extent.join(',') + ")",
                bbox: extent.join(',') + ',EPSG:3857'
            }
        }).done(function (response) {
            sourceWFS.addFeatures(formatWFS.readFeatures(response));
        });
    },
    strategy: ol.loadingstrategy.bbox,
    projection: 'EPSG:3857'
});*/

var sourceWFS = new ol.source.Vector({
    format: new ol.format.GeoJSON(),
    url: function(extent) {
        return 'http://geocatalogue.databenc.it/geoserver/chis_test/ows?service=WFS&' +
            'version=1.1.0&request=GetFeature&typename=chis_test:wfs_geom&' +
            'outputFormat=application/json&srsname=EPSG:3857&' +
            'bbox=' + extent.join(',') + ',EPSG:3857';
    },
    strategy: ol.loadingstrategy.bbox,
    projection: projection
});

var layerWFS = new ol.layer.Vector({
    source: sourceWFS
});

var interaction;

var interactionSelectPointerMove = new ol.interaction.Select({
    condition: ol.events.condition.pointerMove
});

var interactionSelect = new ol.interaction.Select({
    style: new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: '#FF2828'
        })
    })
});

var interactionSnap = new ol.interaction.Snap({
    source: layerWFS.getSource()
});

var raster = new ol.layer.Tile({
    source: new ol.source.OSM({
        url: 'https://cartodb-basemaps-{a-d}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png',
        opaque: false,
        attributions: []
    })
});

var map = new ol.Map({
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
var dirty = {};
var transactWFS = function (mode, f) {
    var node;
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
    var payload = xs.serializeToString(node);
    $.ajax('http://geocatalogue.databenc.it/geoserver/chis_test/ows', {
        type: 'POST',
        dataType: 'xml',
        processData: false,
        contentType: 'text/xml',
        data: payload
    }).done(function() {
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

$('#btnZoomIn').on('click', function() {
    var view = map.getView();
    var newResolution = view.constrainResolution(view.getResolution(), 1);
    view.setResolution(newResolution);
});

$('#btnZoomOut').on('click', function() {
    var view = map.getView();
    var newResolution = view.constrainResolution(view.getResolution(), -1);
    view.setResolution(newResolution);
});