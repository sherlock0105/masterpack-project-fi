/*global QUnit*/

sap.ui.define([
	"zpe3/fi/asset/zpe3fiasset/controller/AssetView.controller"
], function (Controller) {
	"use strict";

	QUnit.module("AssetView Controller");

	QUnit.test("I should test the AssetView controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
