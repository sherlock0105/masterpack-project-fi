/*global QUnit*/

sap.ui.define([
	"ze3/fi/hbk/rate/ze3fihbkrate/controller/FiRateView.controller"
], function (Controller) {
	"use strict";

	QUnit.module("FiRateView Controller");

	QUnit.test("I should test the FiRateView controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
