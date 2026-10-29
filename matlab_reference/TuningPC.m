function [ clusters, referencias, intentos, deltas, total_rot, solape, kf, Df ] = TuningPC( nop, dpo, solape, kf, Df, semilla, max_rotaciones )
    
    tol = 0.0001;           % Tolerancia para la diferencia de distancias
    [ cluster, referencia, intentos, ~, deltas ] = ...
        agloGen3D( semilla, dpo( 1 ), solape( 1 ), 'PC' );            
    referencias = cell( 1, 1 );
    referencias( 1 , 1 ) = referencia;
    clusters = cell( nop, 1 );
    for np = 1 : semilla
        clusters{ np, 1 } = [ 1 np cluster( np, : ) ];
    end
    total_rot = ones( nop, 1 );

    %% Inicializacion de la geometria
    %  Tras el primer cluster se calculan las respectivas distancias al centro de masas (cdm) del
    %  aglomerado de las particulas existentes en el mismo
    cdm = calculateGeometricalCentre( clusters );
    distancias = zeros( nop, 1 );
    particulas = cell2mat( clusters );
    % Desplazamos los centros para que coincida con el cdm su origen
    centros = particulas( :, 3 : 5 );
    centros = desplazarCoordenadas( centros, -cdm );
    radios = particulas( :, 6 );
    distancias( 1 : semilla, 1 ) = sqrt( sum( ( centros - repmat( cdm, semilla, 1 ) ) .^ 2, 2 ) );
    constante = 3/5;    % Lapuerta = 3/5; Filipov = 0;

    %% Comenzamos con el algoritmo 
    %  Añadimos partículas una a una hasta que completamos el proceso
    for np = semilla + 1 : nop
        % Cálculo de la distancia a la cual debe colocarse la nueva partícula. Primero vemos si el
        % aglomerado es monodisperso o polidisperso. En este caso habría que calcular el valor
        % promedio del radio
        if numel( dpo ) > 1
            rp = mean( dpo ) / 2;
        else
            rp = dpo / 2;
        end % if
        gamma1 = ( np ^ 2 / ( np - 1 ) ) * ( ( np / kf ) ^ ( 2 / Df ) - constante );
        gamma2 = np * ( ( ( np - 1 ) / kf ) ^ ( 2 / Df ) - constante );
        gamma3 = ( np / ( np - 1 ) ) * ( ( 1 / kf ) ^ ( 2 / Df ) - constante );
        gamma4 = sqrt( gamma1 - gamma2 - gamma3 );
        gamma = rp * gamma4;
        distancias( np, 1 ) = gamma;

        % Creamos la lista de particulas que pueden estar en contacto con la partícula a agregar
        LAmin = 1 : np - 1;
        LAmin = LAmin( distancias( 1 : np - 1 ) > ( gamma - 2 * rp ) );
        if isempty( LAmin )
            error( 'Unable to construct agglomerate! LAmin empty' );
        end % if isempty

        %% Creación de la lista de partículas LB, que en principio es idéntica a LA-
        LB = LAmin;

        %% Bucle principal del proceso
        while ( numel( LB ) > 0 )
            % Selección de la partícula de referencia de LB
            referencia = LB( randi( [ 1 numel( LB ) ] ) );                    
            CB = centros( referencia, : );                      % Centro de la de referencia
            rB = radios( referencia );                          % Radio de la de referencia

            % Generación de la lista de partículas que podrían intersectar con la seleccionada
            % Eliminación de la partícula de referencia para futuros cálculos
            centrosLB = centros( LB, : );    % Centros del resto de partículas de LB
            radiosLB  = radios( LB );        % Radios del resto de partículas de LB
            distanciasLBref = sqrt( sum( ( centrosLB - repmat( CB, size( centrosLB, 1 ), 1 ) ) .^ 2, 2 ) );

            % Condición para pertenecer al conjunto LA+
            LAplus = LB( distanciasLBref < 2 * ( repmat( rB, size( radiosLB, 1 ), 1 ) + radiosLB ) );
            % Hay que eliminar a la de referencia de este conjunto
            LAplus = setdiff( LAplus, referencia );

            %% Colocación de la nueva partícula en la esfera de posición
            %  Primero hay que tener en cuenta que se ha de rotar el vector CB un ángulo alpha.
            %  Para poder rotarlo hay que elegir un vector unitario que no sea paralelo a CB
            %  Después, usando álgebra de cuaterniones se rota de forma sencilla, determinando alpha
            %  para la rotación de CB
            alpha = acos( ( gamma ^ 2  + norm( CB ) ^ 2 - ( rB + rp ) ^ 2 ) / ( 2 * gamma * norm( CB ) ) );

            % Vector aleatorio unitario T1
            [ ~, ~, a, b, c ] = determineAngles( 1 );
            T1 = [ a b c ];
            % Calculamos el producto vectorial        
            T2 = cross( T1, CB );
            % Si es paralelo a CB hay que repetir el proceso hasta que no lo sea
            while ( norm( T2 ) == 0 )
                [ ~, ~, a, b, c ] = determineAngles( 1 );
                T1 = [ a b c ];
                T2 = cross( T1, CB );
            end % while ( norm( T2 ) == 0 )

            % Hacemos unitario T2
            T2 = T2 / norm( T2 );

            % Construimos el cuaternio de rotación Qalpha y su conjugado
            Qalpha = [ cos( alpha / 2 ) T2 * sin( alpha / 2 ) ];
            Qalphaconj = conjugar_cuaternio( Qalpha );

            % Rotamos CB alpha grados, el resultado de la rotación es el vector CA, cuyo módulo es
            % gamma. Para garantizar que tenga de módulo gamma hacemos CB unitario
            CBu = CB / norm( CB );
            CA  = multiplica_cuaternion( Qalpha, [ 0 CBu ] );
            CA  = multiplica_cuaternion( CA, Qalphaconj );
            CA  = CA * gamma;                               % Hacemos que tenga módulo gamma

            % Ahora queda la rotación un ángulo betha
            beta = unifrnd( 0, 2 * pi() );
            % Definimos el cuaternio de rotación unitario alrededor de CB y su conjugado
            Qbeta = [ cos( beta / 2 ) CBu * sin( beta / 2 ) ];
            Qbetaconj = conjugar_cuaternio( Qbeta );
            CA = multiplica_cuaternion( Qbeta, CA );
            CA = multiplica_cuaternion( CA, Qbetaconj );
            CA = CA( 2 : end );

            % Poner a cero el contador de rotaciones
            rotaciones = max_rotaciones;

            %% Comprobación de que la nueva partícula se puede añadir (no intersecta con ninguna otra que
            %  esté en LA+)
            while ( rotaciones > 0 )
                if ( numel( LAplus ) > 0 )
                    % Extraemos los centros y radios de las partículas que pueden solaparse con la
                    % recién llegada
                    centrosLAplus = centros( LAplus, : );
                    radiosLAplus  = radios( LAplus, : );
                    % Comprobamos la condición de solape (lista C - LC )
                    distanciasLAplusCA = sqrt( sum( ( centrosLAplus - ...
                        repmat( CA, size( centrosLAplus, 1 ), 1 ) ).^ 2, 2 ) );
                    LC = LAplus( distanciasLAplusCA - ( radiosLAplus + rB ) < tol );
                    if isempty( LC )
                        % Se puede añadir la nueva partícula
                        % Actualizamos primero el vector total_rot
                        total_rot( np, 1 ) = 25 - rotaciones + 1;   % Al menos una vez se ha rotado
                        % Condicion de salida de este bucle. 
                        break;
                    else
                        % Hay que recolocar la nueva partícula (LA+ y referencia siguen igual)
                        % Ahora queda la rotación un ángulo betha
                        beta = unifrnd( 0, 2 * pi() );
                        % Definimos el cuaternio de rotación unitario alrededor de CB y su conjugado
                        Qbeta = [ cos( beta / 2 ) CBu * sin( beta / 2 ) ];
                        Qbetaconj = conjugar_cuaternio( Qbeta );
                        CA = multiplica_cuaternion( Qbeta, [ 0 CA ] );
                        CA = multiplica_cuaternion( CA, Qbetaconj );
                        CA = CA( 2 : end );
                        % Actualizamos el vector de rotaciones ( lo decrementamos )
                        rotaciones = rotaciones - 1 ;                                
                    end % if iempty( LC )
                else
                    % La partícula se puede agregar sin problema, actualizar total_rot y rotaciones
                    total_rot( np, 1 ) = 25 - rotaciones + 1;
                    break;                            
                end % if ( numel( LAplus ) > 0 )
            end % while ( rotaciones > 0 )

            % Si se ha salido del bucle anterior y rotaciones es mayor que cero, hay que salir de este
            % bucle while también
            if ( rotaciones > 0 )
                break;
            else
                % Hay que actualizar LB para que no vuelva a tomar la misma partícula como referencia
                % para girar
                LB = setdiff( LB, referencia );
            end % if ( rotaciones > 0 )

            % Si no, hay que seguir y elegir otra partícula de LB y repetir el proceso
        end % while ( numel( LB ) > 0 )

        % Actualizamos la geometría
        clusters{ np, 1 } = [ 1 np CA rp ];
        particulas = cell2mat( clusters );
        % Desplazamos los centros para que coincida con el cdm su origen                
        cdm = calculateGeometricalCentre( clusters );        
        centros = particulas( :, 3 : 5 );
        centros = desplazarCoordenadas( centros, -cdm );
        radios = particulas( :, 6 );
        cG  = calculateCentreOfGravity( [ centros radios ] );
        eSDiam = determineMaximumDiameter( [ centros radios ], 1, [ 0 0 0 ] );
        roG = calculateRadiusOfGyration( [ centros radios ], 1, cG );
        % Actualizamos el radio de giro y las coordenadas del centro de gravedad
        centro = { np [ 0 0 0 eSDiam; cG roG ] };
        referencias{ np, 1 } = centro;

        %% Regeneramos la geometría y el vector de distancias
        for ss = 1 : np
            clusters{ ss, 1 } = [ 1 ss centros( ss, : ) radios( ss ) ];
            distancias( ss, 1 ) = norm( centros( ss, : ) );
        end
        % h = plotAgglomerate( [ centros radios ] );
        deltas( np, 1 ) = 1;
    end
end

