import { convertTypeName, convertConstant } from "../glsl/types";
import { ShaderGenerator, ProgramGenerator } from "../glsl/glsl";
import { Specification } from "stardust-core";
import { Binding } from "stardust-core";
import { Dictionary } from "stardust-core";

export enum GenerateMode {
    NORMAL = 0,
    PICK = 1,
    FRAGMENT = 2
}


export enum ViewType {
    VIEW_2D = 0,
    VIEW_3D = 1,      // 3D mode.
    VIEW_WEBVR = 2    // WebVR mode.
}


export class GLSLVertexShaderGenerator extends ShaderGenerator {
    private _parent: Generator;

    constructor(parent: Generator) {
        super();
        this._parent = parent;
    }

    public addEmitStatement(sEmit: Specification.StatementEmit) {
        for (let name in sEmit.attributes) {
            this.addLine(`${this._parent._voutMapping.get(name)} = ${this.generateExpression(sEmit.attributes[name])};`);
        }
        let position = this._parent._voutMapping.get("position");
        switch (this._parent._spec.output["position"].type) {
            case "Vector2": {
                this.addLine(`gl_Position = s3_render_vertex(vec3(${position}, 0.0));`);
            } break;
            case "Vector3": {
                this.addLine(`gl_Position = s3_render_vertex(${position});`);
            } break;
            case "Vector4": {
                this.addLine(`gl_Position = s3_render_vertex(${position}.xyz);`);
            } break;
        }
    }
}

export class GLSLFragmentShaderGenerator extends ShaderGenerator {
    private _parent: Generator;

    constructor(parent: Generator) {
        super();
        this._parent = parent;
    }

    public addEmitStatement(sEmit: Specification.StatementEmit) {
        this.addLine(`gl_FragColor = ${this.generateExpression(sEmit.attributes["color"])};`);
    }
}

export class Generator extends ProgramGenerator {
    public _vertex: GLSLVertexShaderGenerator;
    public _fragment: GLSLFragmentShaderGenerator;

    private _mode: GenerateMode;
    private _viewType: ViewType;

    private _vertexCode: string;
    private _fragmentCode: string;

    public _voutMapping: Dictionary<string>;
    public _foutMapping: Dictionary<string>;
    public _fragmentOutputName: string;

    constructor(spec: Specification.Mark, shader: Specification.Shader, asUniform: (name: string) => boolean, viewType: ViewType, mode: GenerateMode = GenerateMode.NORMAL) {
        super(spec, shader, asUniform);

        this._mode = mode;
        this._viewType = viewType;

        this._vertex = new GLSLVertexShaderGenerator(this);
        this._fragment = new GLSLFragmentShaderGenerator(this);

        this.compile();
    }

    public compile() {
        let spec = this._spec;
        let shader = this._shader;
        let asUniform = this._asUniform;

        this._voutMapping = new Dictionary<string>();
        this._foutMapping = new Dictionary<string>();

        this._vertex.addLine("precision highp float;");

        // Global attributes.
        for (let name in spec.input) {
            if (spec.input.hasOwnProperty(name)) {
                if (asUniform(name)) {
                    this._vertex.addUniform(name, spec.input[name].type);
                } else {
                    this._vertex.addAttribute(name, spec.input[name].type);
                }
            }
        }
        if (this._mode == GenerateMode.PICK) {
            this._vertex.addAttribute("s3_pick_index", "Vector4");
            this._vertex.addUniform("s3_pick_index_alpha", "float");
        }
        switch (this._viewType) {
            case ViewType.VIEW_2D: {
                this._vertex.addUniform("s3_view_params", "Vector4");
                this._vertex.addAdditionalCode(`
                    vec4 s3_render_vertex(vec3 p) {
                        return vec4(p.xy * s3_view_params.xy + s3_view_params.zw, 0.0, 1.0);
                    }
                `);
            } break;
            case ViewType.VIEW_3D: {
                this._vertex.addUniform("s3_view_params", "Vector4");
                this._vertex.addUniform("s3_view_position", "Vector3");
                this._vertex.addUniform("s3_view_rotation", "Vector4");
                this._vertex.addAdditionalCode(`
                    vec4 s3_render_vertex(vec3 p) {
                        // Get position in view coordinates:
                        //   v = quaternion_inverse_rotate(rotation, p - position)
                        vec3 v = p - s3_view_position;
                        float d = dot(s3_view_rotation.xyz, v);
                        vec3 c = cross(s3_view_rotation.xyz, v);
                        v = s3_view_rotation.w * s3_view_rotation.w * v - (s3_view_rotation.w + s3_view_rotation.w) * c + d * s3_view_rotation.xyz - cross(c, s3_view_rotation.xyz);
                        // Compute projection.
                        vec4 r;
                        r.xy = v.xy * s3_view_params.xy;
                        r.z = v.z * s3_view_params.z + s3_view_params.w;
                        r.w = -v.z;
                        return r;
                    }
                `)
            } break;
            case ViewType.VIEW_WEBVR: {
                // For WebVR, we use the MVP matrix provided by it.
                this._vertex.addUniform("s3_projection_matrix", "Matrix4");
                this._vertex.addUniform("s3_view_matrix", "Matrix4");
                this._vertex.addUniform("s3_view_position", "Vector3");
                this._vertex.addUniform("s3_view_rotation", "Vector4");
                this._vertex.addAdditionalCode(`
                    vec4 s3_render_vertex(vec3 p) {
                        vec3 v = p - s3_view_position;
                        float d = dot(s3_view_rotation.xyz, v);
                        vec3 c = cross(s3_view_rotation.xyz, v);
                        v = s3_view_rotation.w * s3_view_rotation.w * v - (s3_view_rotation.w + s3_view_rotation.w) * c + d * s3_view_rotation.xyz - cross(c, s3_view_rotation.xyz);
                        return s3_projection_matrix * s3_view_matrix * vec4(v, 1);
                    }
                `)
            } break;
        }
        this._vertex.addLine("@additionalCode");
        // Output attributes.
        for (let name in spec.output) {
            if (spec.output.hasOwnProperty(name)) {
                let oname = this.getUnusedName(name);
                this._voutMapping.set(name, oname);
                this._vertex.addVarying(oname, spec.output[name].type);
            }
        }
        if (this._mode == GenerateMode.PICK) {
            this._vertex.addVarying("out_pick_index", "Vector4");
        }
        // The main function.
        this._vertex.addLine("void main() {");
        this._vertex.indent();
        // Define arguments.
        for (let name in spec.variables) {
            if (spec.variables.hasOwnProperty(name)) {
                let type = spec.variables[name];
                this._vertex.addDeclaration(name, type);
            }
        }
        this._vertex.addStatements(spec.statements);
        this._vertex.unindent();
        this._vertex.addLine("}");

        this._vertexCode = this._vertex.getCode();

        if (this._mode == GenerateMode.PICK) {
            this._fragmentCode = `
                precision highp float;
                varying vec4 out_pick_index;
                void main() {
                    gl_FragColor = out_pick_index;
                }
            `;
        } else {

            this._fragment.addLine("precision highp float;");
            // Global attributes.
            for (let name in shader.input) {
                if (shader.input.hasOwnProperty(name)) {
                    if (spec.output[name]) {
                        let oname = this._voutMapping.get(name);
                        this._fragment.addVarying(oname, shader.input[name].type);
                    } else {
                        if (asUniform(name)) {
                            this._fragment.addUniform(name, shader.input[name].type);
                        }
                    }
                }
            }
            // Output attributes.
            for (let name in shader.output) {
                if (shader.output.hasOwnProperty(name)) {
                    let oname = this.getUnusedName(name);
                    this._foutMapping.set(name, oname);
                    this._fragment.addDeclaration(oname, shader.output[name].type);
                }
            }
            // The main function.
            this._fragment.addLine("void main() {");
            this._fragment.indent();
            // Define arguments.
            for (let name in shader.variables) {
                if (shader.variables.hasOwnProperty(name)) {
                    let type = shader.variables[name];
                    this._fragment.addDeclaration(name, type);
                }
            }
            for (let name in shader.input) {
                if (shader.input.hasOwnProperty(name)) {
                    if (spec.output[name]) {
                        this._fragment.addLine(`${convertTypeName(spec.input[name].type)} ${name} = ${this._voutMapping.get(name)};`);
                    } else {
                        this._fragment.addLine(`${convertTypeName(spec.input[name].type)} ${name};`);
                    }
                }
            }
            this._fragment.addStatements(shader.statements);
            this._fragment.unindent();
            this._fragment.addLine("}");
            this._fragmentCode = this._fragment.getCode();
        }
    }

    public getVertexCode(): string {
        return this._vertexCode;
    }

    public getFragmentCode(): string {
        return this._fragmentCode;
    }
}