function fig_hdl = nueva_img_boton_english_build
% DATOS_IMAGENES_BUILD
%-------------------------------------------------------------------------------
% File name   : nueva_img_boton_english_build.m
%-------------------------------------------------------------------------------


% Initialize handles structure
handles = struct();

% Create all UI controls
build_gui();

% Assign function output
fig_hdl = handles.figura_otra_imagen;

%% ---------------------------------------------------------------------------

% Variables

handles.primeravezi=1;

handles.dfmat=getappdata(0,'dfmat');
handles.delta_inicio=getappdata(0,'delta_inicio');
handles.delta_fin=getappdata(0,'delta_fin');
handles.delta_intervalo=getappdata(0,'delta_intervalo');
handles.version=getappdata(0,'version');

handles.n_veces_nueva_img=getappdata(0,'n_veces_nueva_img');

%% ---------------------------------------------------------------------------
	function build_gui()
% Creation of all uicontrols

		% --- FIGURE -------------------------------------
		handles.figura_otra_imagen = figure( ...
			'Tag', 'figura_otra_imagen', ...
			'Units', 'characters', ...
			'Position', [9.8 6.76923076923077 102.2 36], ...
			'Name', 'New_image', ...
			'MenuBar', 'none', ...
			'NumberTitle', 'off', ...
			'Color', get(0,'DefaultUicontrolBackgroundColor'));

		% --- AXES -------------------------------------
		handles.img_seleccionada_axes = axes( ...
			'Parent', handles.figura_otra_imagen, ...
			'Tag', 'img_seleccionada_axes', ...
			'Units', 'characters', ...
			'Position', [29.1 2 44 16.9230769230769], ...
            'visible', 'off');
        
        % --- STATIC TEXTS -------------------------------------

		handles.npix_texto = uicontrol( ...
			'Parent', handles.figura_otra_imagen, ...
			'Tag', 'npix_texto', ...
			'UserData', zeros(1,0), ...
			'Style', 'text', ...
			'Units', 'characters', ...
			'Position', [23 28 25.4 1.30769230769231], ...            
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
			'String', 'n. pixels/100nm');

		handles.dpo_mat_texto = uicontrol( ...
			'Parent', handles.figura_otra_imagen, ...
			'Tag', 'dpo_mat_texto', ...
			'UserData', zeros(1,0), ...
			'Style', 'text', ...
			'Units', 'characters', ...
			'Position', [19 23 35.2 3.30769230769231], ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
			'String', {'Average diameter of the';'particles'});

		% --- PUSHBUTTONS -------------------------------------
		
        handles.sub_img_boton = uicontrol( ...
			'Parent', handles.figura_otra_imagen, ...
			'Tag', 'sub_img_boton', ...
			'Style', 'pushbutton', ...
			'Units', 'characters', ...
			'Position', [2.8 31 20.2 2.23076923076923], ...
			'String', 'Upload image', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
			'Callback', @sub_img_boton_Callback);

		handles.guardar_datos_boton = uicontrol( ...
			'Parent', handles.figura_otra_imagen, ...
			'Tag', 'guardar_datos_boton', ...
			'Style', 'pushbutton', ...
			'Units', 'characters', ...
			'Position', [39 20 24.2 2.23076923076923], ...
			'String', 'Save data', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Callback', @guardar_datos_boton_Callback);

		% --- EDIT TEXTS -------------------------------------
		
        handles.imagen_textoblanco = uicontrol( ...
			'Parent', handles.figura_otra_imagen, ...
			'Tag', 'imagen', ...
			'UserData', zeros(1,0), ...
			'Style', 'edit', ...
			'Units', 'characters', ...
			'Position', [24.8 31 74.2 2.23076923076923], ...
			'BackgroundColor', [1 1 1], ...
			'String', {''}, ...
            'enable', 'off');

		handles.npix_entrada = uicontrol( ...
			'Parent', handles.figura_otra_imagen, ...
			'Tag', 'npix', ...
			'Style', 'edit', ...
			'Units', 'characters', ...
			'Position', [55 28 20.2 1.69230769230769], ...
			'BackgroundColor', [1 1 1], ...
			'String', 'npix', ...
            'FontSize', 12, ...
            'FontName', 'Candara');

		handles.dpomat_entrada = uicontrol( ...
			'Parent', handles.figura_otra_imagen, ...
			'Tag', 'dpomat', ...
			'Style', 'edit', ...
			'Units', 'characters', ...
			'Position', [55 24 20.2 1.69230769230769], ...
			'BackgroundColor', [1 1 1], ...
			'String', 'dpo', ...
            'FontSize', 12, ...
            'FontName', 'Candara');
        
    movegui(handles.figura_otra_imagen,'center')

    end

%% ---------------------------------------------------------------------------
	function sub_img_boton_Callback(hObject,evendata) %#ok<INUSD>
        if handles.primeravezi==1
            [handles.imagen,handles.dir_img_ind]=uigetfile({'*.jpg',...
                'Archivo jpg';'*.*','All Files'},'Select a image');
        else
            [handles.imagen,handles.dir_img_ind]=uigetfile({'*.jpg',...
                'Archivo jpg';'*.*','All Files'},'Select a image',...
                handles.dir_img_ind);
        end
        
        if ~isequal(handles.imagen,0)
            set(handles.imagen_textoblanco,'string',strcat(handles.dir_img_ind,handles.imagen));
            set(handles.img_seleccionada_axes,'visible','on');
            axes(handles.img_seleccionada_axes)
            background = imread(strcat(handles.dir_img_ind,handles.imagen));
            axis off;
            imshow(background);
            handles.primeravezi=0;
        end
        
	end

%% ---------------------------------------------------------------------------
	function guardar_datos_boton_Callback(hObject,evendata) %#ok<INUSD>
        error_igual=0;
        handles.npix=str2double(get(handles.npix_entrada,'string'));
        handles.dpo_mat=str2double(get(handles.dpomat_entrada,'string'));
        
        [handles.carpeta_img_ind,handles.nombre_img_ind,handles.extension_img_ind]=fileparts(strcat(handles.dir_img_ind,handles.imagen));
        
        if handles.npix<0 || handles.dpo_mat<0 || strcmp(handles.imagen,'0')==1
            error=errordlg('Some data is not a positive number or the image has not been selected','Error');            
                kids0=findobj(error,'Type','UIControl');
                kids1=findobj(error,'Type','Text');

                % change the font and fontsize
                extent0=get(kids1,'Extent'); % text extent in old font
                set([kids0,kids1],'FontName','Candara','FontSize',12);
                set(kids0,'Foregroundcolor',[0.4 0.3 1]);
                extent1=get(kids1,'Extent'); % text extent in new font

                % need to resize the msgbox object to accommodate new FontName
                % and FontSize
                delta=extent1-extent0; % change in extent
            
                pos=get(kids0,'Position'); % msgbox current position
                pos=pos+delta; % change size of msgbox
                set(kids0,'Position',pos); % set new position
            
                pos=get(error,'Position'); % msgbox current position
                pos=pos+delta; % change size of msgbox
                set(error,'Position',pos); % set new position
                
        elseif handles.npix>=0 && handles.dpo_mat>=0
            
            col = get(handles.guardar_datos_boton,'backg');  % Get the background color of the figure.
            set(handles.guardar_datos_boton,'str','WORKING...','backg',[1 .6 .6]) % Change color of button. 
        
            pause(.01)  % FLUSH the event queue, drawnow would work too.
        
            handles.nfoto={strcat(handles.dir_img_ind,handles.imagen)};
            handles.foto={handles.nombre_img_ind};
            handles.npixescala=handles.npix;
            handles.dpomat=handles.dpo_mat;
            
            otras_imagenes={};
            for i=1:size(handles.dfmat,1)
                otras_imagenes{i}=handles.dfmat{i}{1,1};
            end
            for i=1:length(otras_imagenes)
                if strcmp(otras_imagenes{i},handles.foto{1})==1
                    error_igual=1;
                end
            end
            if error_igual==1
                error=errordlg('Image has been already uploaded','Error');                
                    kids0=findobj(error,'Type','UIControl');
                    kids1=findobj(error,'Type','Text');

                    % change the font and fontsize
                    extent0=get(kids1,'Extent'); % text extent in old font
                    set([kids0,kids1],'FontName','Candara','FontSize',12);
                    set(kids0,'Foregroundcolor',[0.4 0.3 1]);
                    extent1=get(kids1,'Extent'); % text extent in new font

                    % need to resize the msgbox object to accommodate new FontName
                    % and FontSize
                    delta=extent1-extent0; % change in extent
            
                    pos=get(kids0,'Position'); % msgbox current position
                    pos=pos+delta; % change size of msgbox
                    set(kids0,'Position',pos); % set new position
            
                    pos=get(error,'Position'); % msgbox current position
                    pos=pos+delta; % change size of msgbox
                    set(error,'Position',pos); % set new position
                    
                set(handles.guardar_datos_boton,'String','Tomar datos','backg',col)  % Now reset the button features.
            else
                handles.dfmatnueva=[];
                for delta=handles.delta_inicio:handles.delta_intervalo:handles.delta_fin
                    dfmat2012=GeneralExe2012(handles.foto,handles.nfoto,handles.npixescala,handles.dpomat,0,delta);
                    handles.dfmatnueva=[handles.dfmatnueva;dfmat2012];
                end
                handles.dfmat{size(handles.dfmat,1)+1,1}=handles.dfmatnueva; setappdata(0,'dfmat',handles.dfmat);
                handles.version{size(handles.version,1)+1,1}='2012'; setappdata(0,'version',handles.version);
                    
                set(handles.guardar_datos_boton,'String','Save data','backg',col)  % Now reset the button features.
            
                handles.n_veces_nueva_img=handles.n_veces_nueva_img+1; setappdata(0,'n_veces_nueva_img',handles.n_veces_nueva_img);
            
                close;
            end
        else 
            error=errordlg('Some input data is not a number','Error');            
                kids0=findobj(error,'Type','UIControl');
                kids1=findobj(error,'Type','Text');

                % change the font and fontsize
                extent0=get(kids1,'Extent'); % text extent in old font
                set([kids0,kids1],'FontName','Candara','FontSize',12);
                set(kids0,'Foregroundcolor',[1 0 0]);
                extent1=get(kids1,'Extent'); % text extent in new font

                % need to resize the msgbox object to accommodate new FontName
                % and FontSize
                delta=extent1-extent0; % change in extent
            
                pos=get(kids0,'Position'); % msgbox current position
                pos=pos+delta; % change size of msgbox
                set(kids0,'Position',pos); % set new position
            
                pos=get(error,'Position'); % msgbox current position
                pos=pos+delta; % change size of msgbox
                set(error,'Position',pos); % set new position
                
        end
    end

end