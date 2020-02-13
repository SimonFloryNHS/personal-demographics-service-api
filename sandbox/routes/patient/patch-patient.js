const Boom = require('boom')
const fs = require('fs')
const nhsNumberHelper = require('../../helpers/nhs-number-helper')
const fhirHelper = require('../../helpers/fhir-helper')
const jsonpatch = require('fast-json-patch')

const EXAMPLE_PATIENT = JSON.parse(fs.readFileSync('mocks/Patient-Jane-Smith.json'))

module.exports = [
    {
        /*
            Patient partial update
            Behaviour:
            * No If-Match Header: 400 DONE
            * If-Match header does not match resource latest: 412 Precondition Failed DONE
            * Invalid request body: 400(?)
            * Non-existant patient: 404 DONE
            * Invalid NHS Number: 400 DONE
            * Unset/invalid Content-Type: 415 Unsupported Media Type DONE
        */
        method: 'PATCH',
        path: '/Patient/{nhsNumber}',
        handler: (request, h) => {
            nhsNumberHelper.checkNhsNumber(request)

            // Check If-Match header exists
            // TODO: Return different error where If-Match header is incorrect format
            if (
                !request.headers["if-match"] ||
                !(request.headers["if-match"].startsWith('W/"') && request.headers["if-match"].endsWith('"'))) {
                throw Boom.badRequest(
                    "If-Match header must be supplied to update this resource",
                    {operationOutcomeCode: "required", apiErrorCode: "versionNotSupplied"}
                )
            }

            // Check If-Match header is correct version
            const ifMatch = request.headers["if-match"].slice(3, -1) // Strip the W/"..."
            if (ifMatch != EXAMPLE_PATIENT.meta.versionId) {
                throw Boom.preconditionFailed(
                    "This resource has changed since you last read. Please re-read and try again with the new version number.",
                    {operationOutcomeCode: "conflict", apiErrorCode: "versionMismatch"})
            }

            // Check Content-Type header
            if (!request.headers["content-type"]
                || request.headers["content-type"].toLowerCase() !== "application/json-patch+json") {
                // TODO: What's the proper error here?
                throw Boom.unsupportedMediaType(
                    "Must be application/json-patch+json",
                    {operationOutcomeCode: "value", apiErrorCode: "unsupportedMediaType"})
            }

            // Verify at least one patch object has been submitted
            if (!request.payload || !request.payload.patches || request.payload.patches.length === 0) {
                // TODO: Proper error message
                throw Boom.badRequest(
                    "No patches submitted",
                    {operationOutcomeCode: "required", apiErrorCode: "noPatchesSubmitted"})
            }

            // Apply the submitted patches
            let patchedPatient
            try {
                patchedPatient = jsonpatch.applyPatch(EXAMPLE_PATIENT, request.payload.patches, true, false).newDocument
            }
            catch (e) {
                const patchingError = e.message.slice(0, e.message.indexOf('\n')) // Just the first line; rest is tons of extraneous detail
                throw Boom.badRequest(
                    `Invalid patch: ${patchingError}`,
                    {operationOutcomeCode: "value", apiErrorCode: "invalidPatchOperation"})
            }
            patchedPatient.meta.versionId++

            return fhirHelper.createFhirResponse(h, patchedPatient)
        }
    }
]