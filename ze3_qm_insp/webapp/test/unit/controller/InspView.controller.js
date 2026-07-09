/*global QUnit*/

sap.ui.define([
	"ze3/qm/insp/ze3qminsp/controller/InspView.controller"
], function (Controller) {
	"use strict";

	QUnit.module("InspView Controller");

	QUnit.test("I should test the InspView controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
