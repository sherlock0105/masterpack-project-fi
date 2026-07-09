/*global QUnit*/

sap.ui.define([
	"ze3/fi/bpmaster/ze3fibpmaster/controller/BpMasterView.controller"
], function (Controller) {
	"use strict";

	QUnit.module("BpMasterView Controller");

	QUnit.test("I should test the BpMasterView controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
